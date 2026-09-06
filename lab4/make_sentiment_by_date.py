from pathlib import Path
import pandas as pd

BASE = Path(__file__).resolve().parent.parent
INPUT = BASE / "data" / "lab4_clean_tweets.csv"
OUTPUT = BASE / "data" / "sentiment_by_date.csv"

df = pd.read_csv(INPUT)
df["date"] = pd.to_datetime(df["date"], errors="coerce")
df["sentiment_score"] = pd.to_numeric(df["sentiment_score"], errors="coerce")
df = df.dropna(subset=["date", "sentiment_score"])

sentiment_by_date = (
    df.assign(tweet_date=df["date"].dt.strftime("%Y-%m-%d"))
      .groupby("tweet_date", as_index=False)
      .agg(
          sentiment_score=("sentiment_score", "mean"),
          tweet_count=("sentiment_score", "size")
      )
      .sort_values("tweet_date")
)

sentiment_by_date.to_csv(OUTPUT, index=False)
print(f"Saved: {OUTPUT}")
print(sentiment_by_date.head())
print(f"Rows: {len(sentiment_by_date)}")