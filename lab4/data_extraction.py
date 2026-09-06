import argparse
import csv
import re
import sys
from pathlib import Path

import pandas as pd

DATASET_HANDLE = "kaushiksuresh147/bitcoin-tweets"
BASE = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = BASE / "data" / "lab4_raw_tweets.csv"
PREFERRED_COLUMNS = [
    "user_name", "user_location", "user_description", "user_created", "user_followers", "user_friends", "user_favourites", "user_verified", "date", "text", "hashtags", "source", "is_retweet"
]

# Allow unusually long fields in malformed CSV rows.
try:
    csv.field_size_limit(sys.maxsize)
except OverflowError:
    csv.field_size_limit(10_000_000)


def download_dataset():
    try:
        import kagglehub
    except ImportError as exc:
        raise SystemExit("Install kagglehub first: pip install kagglehub") from exc
    print(f"Downloading Kaggle dataset: {DATASET_HANDLE}")
    path = Path(kagglehub.dataset_download(DATASET_HANDLE))
    print(f"Dataset downloaded to: {path}")
    return path


def find_csv_files(dataset_dir):
    files = sorted(dataset_dir.rglob("*.csv"))
    if not files:
        raise FileNotFoundError(f"No CSV files found in {dataset_dir}")
    return files


def choose_csv(csv_files):
    preferred = [p for p in csv_files if re.search(r"tweet|text", p.name, re.I)]
    for path in preferred or csv_files:
        try:
            header = pd.read_csv(path, nrows=0, engine="python", on_bad_lines="skip", encoding="utf-8", encoding_errors="replace")
            cols = {str(c).strip().lower() for c in header.columns}
            if "text" in cols or "tweet" in cols:
                return path
        except Exception:
            pass
    raise ValueError("Could not find a CSV containing a tweet text column.")


def normalize_columns(df):
    rename = {}
    for col in df.columns:
        name = str(col).strip()
        rename[col] = "text" if name.lower() in {"tweet", "tweet_text", "tweettext"} else name
    return df.rename(columns=rename)


def clean_chunk(chunk):
    chunk = normalize_columns(chunk)
    if "text" not in chunk.columns or "date" not in chunk.columns:
        raise ValueError("The dataset must contain both 'text' and 'date' columns.")
    chunk["text"] = chunk["text"].astype("string").str.replace(r"\s+", " ", regex=True).str.strip()
    chunk["date"] = pd.to_datetime(chunk["date"], errors="coerce", format="mixed")
    chunk = chunk.dropna(subset=["text", "date"])
    chunk = chunk[chunk["text"].ne("")]
    chunk = chunk.drop_duplicates(subset=["text"], keep="first")
    return chunk


def get_time_range(csv_path, chunk_size):
    min_date, max_date = None, None
    total_valid = 0
    for chunk in pd.read_csv(csv_path, chunksize=chunk_size, engine="python", on_bad_lines="skip", encoding="utf-8", encoding_errors="replace"):
        chunk = normalize_columns(chunk)
        if "date" not in chunk.columns or "text" not in chunk.columns:
            raise ValueError("The dataset must contain 'date' and 'text' columns.")
        dates = pd.to_datetime(chunk["date"], errors="coerce", format="mixed")
        text = chunk["text"].astype("string").str.strip()
        valid = dates.notna() & text.notna() & text.ne("")
        if valid.any():
            d = dates[valid]
            total_valid += int(valid.sum())
            chunk_min, chunk_max = d.min(), d.max()
            min_date = chunk_min if min_date is None else min(min_date, chunk_min)
            max_date = chunk_max if max_date is None else max(max_date, chunk_max)
    if min_date is None or max_date is None:
        raise ValueError("No valid tweets with usable dates were found.")
    return min_date, max_date, total_valid


def stratified_temporal_sample(csv_path, n, bins, chunk_size, seed, columns):
    min_date, max_date, total_valid = get_time_range(csv_path, chunk_size)
    print(f"Valid dated tweets found: {total_valid:,}")
    print(f"Full time range: {min_date} -> {max_date}")
    if max_date <= min_date:
        raise ValueError("All usable tweets have the same timestamp; temporal sampling is impossible.")

    import numpy as np
    edges = pd.date_range(start=min_date.floor("D"), end=max_date.ceil("D") + pd.Timedelta(days=1), periods=bins + 1)
    targets = [n // bins] * bins
    for i in range(n % bins):
        targets[i] += 1
    reservoirs = [[] for _ in range(bins)]
    seen = [0] * bins
    rng = np.random.default_rng(seed)

    for chunk_no, raw_chunk in enumerate(pd.read_csv(csv_path, chunksize=chunk_size, engine="python", on_bad_lines="skip", encoding="utf-8", encoding_errors="replace"), start=1):
        chunk = clean_chunk(raw_chunk)
        if chunk.empty:
            continue
        bin_ids = pd.cut(chunk["date"], bins=edges, labels=False, include_lowest=True, right=False)
        chunk = chunk.assign(_bin=bin_ids).dropna(subset=["_bin"])
        if chunk.empty:
            continue
        chunk["_bin"] = chunk["_bin"].astype(int)
        for b in range(bins):
            target = targets[b]
            if target == 0:
                continue
            part = chunk.loc[chunk["_bin"] == b, columns]
            for row in part.itertuples(index=False, name=None):
                seen[b] += 1
                if len(reservoirs[b]) < target:
                    reservoirs[b].append(row)
                else:
                    j = int(rng.integers(0, seen[b]))
                    if j < target:
                        reservoirs[b][j] = row
        if chunk_no % 20 == 0:
            print(f"Processed {chunk_no:,} chunks...")

    pieces = [pd.DataFrame(rows, columns=columns) for rows in reservoirs if rows]
    if not pieces:
        raise ValueError("Temporal sampling returned no tweets.")
    sampled = pd.concat(pieces, ignore_index=True).drop_duplicates(subset=["text"], keep="first")
    sampled = sampled.sample(frac=1, random_state=seed).reset_index(drop=True)
    if len(sampled) > n:
        sampled = sampled.head(n)
    return sampled, min_date, max_date, targets, seen


def reorder_columns(df):
    first = [c for c in PREFERRED_COLUMNS if c in df.columns]
    rest = [c for c in df.columns if c not in first]
    return df[first + rest]


def main():
    parser = argparse.ArgumentParser(description="Extract tweets with broad temporal coverage.")
    parser.add_argument("--n", type=int, default=5000, help="Number of tweets to sample. Default: 5000.")
    parser.add_argument("--bins", type=int, default=30, help="Number of equal-width time bins. Default: 30.")
    parser.add_argument("--chunk-size", type=int, default=2000, help="Rows read per chunk. Default: 2000.")
    parser.add_argument("--seed", type=int, default=401, help="Random seed. Default: 401.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help=f"Output file. Default: {DEFAULT_OUTPUT}")
    args = parser.parse_args()
    if args.n < 1000: raise SystemExit("The assignment requires at least 1,000 tweets; use --n >= 1000.")
    if args.bins < 2: raise SystemExit("--bins must be at least 2.")
    if args.chunk_size <= 0: raise SystemExit("--chunk-size must be positive.")

    dataset_dir = download_dataset()
    csv_files = find_csv_files(dataset_dir)
    print("\nCSV files found:")
    for p in csv_files: print(f"  - {p}")
    csv_path = choose_csv(csv_files)
    print(f"\nUsing: {csv_path}")
    header = normalize_columns(pd.read_csv(csv_path, nrows=0))
    columns = list(header.columns)
    sampled, min_date, max_date, targets, seen = stratified_temporal_sample(csv_path, args.n, args.bins, args.chunk_size, args.seed, columns)
    sampled = reorder_columns(sampled)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    sampled.to_csv(args.output, index=False, encoding="utf-8")
    print(f"\nSaved: {args.output}")
    print(f"Rows: {len(sampled):,}")
    print(f"Time range: {min_date.date()} -> {max_date.date()}")
    print(f"Temporal bins: {args.bins}")
    print("\nPer-bin target / available counts:")
    for i, (target, available) in enumerate(zip(targets, seen), 1): print(f"  Bin {i:02d}: target={target}, available={available}")
    print("\nRun clean_data.py after this step.")


if __name__ == "__main__":
    main()