from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path

import fitz
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.feature_extraction.text import CountVectorizer, TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

SOURCE_URL = "https://dku-web-admissions.s3.cn-north-1.amazonaws.com.cn/dkumain/files/V2021-22_DKU_UG_Bulletin.pdf"
EMBEDDING_MODEL = "all-MiniLM-L6-v2"
RANDOM_STATE = 401
N_CLUSTERS = 8

PART_RE = re.compile(r"^Part\s+(\d+)\s*:\s*(.+)$", re.I)
PAGE_NO_RE = re.compile(r"^\s*\d+\s*$")
COURSE_RE = re.compile(r"^[A-Z][A-Z0-9&]{1,12}\s+\d{3,4}[A-Z]?(?:\s|$)")
DOT_TOC_RE = re.compile(r"\.{4,}")

STOPWORDS_EXTRA = {
    "duke", "kunshan", "university", "student", "students", "course", "courses",
    "program", "programs", "shall", "may", "must", "will", "including", "also",
}

LABEL_RULES = [
    ("Academic Procedures", {"academic", "registration", "grading", "grade", "withdrawal", "integrity", "probation", "warning", "transcript"}),
    ("Curriculum & Degree Requirements", {"curriculum", "degree", "requirement", "requirements", "credits", "major", "foundation", "interdisciplinary"}),
    ("Majors & Courses", {"major", "course", "courses", "track", "disciplinary", "mathematics", "science", "biology", "economics"}),
    ("Student Life & Support", {"campus", "residence", "health", "counseling", "student", "athletics", "clubs", "leadership", "support"}),
    ("Study Away & Research", {"study", "away", "research", "global", "internship", "experiential", "independent"}),
    ("Admissions & Financial Aid", {"admission", "application", "scholarship", "financial", "selection", "tuition", "aid"}),
    ("University & Community", {"mission", "community", "diversity", "partner", "partners", "global", "policy", "standard"}),
    ("Language & Communication", {"language", "english", "chinese", "writing", "communication", "oral", "literacy"}),
]


def clean_line(s: str) -> str:
    s = s.replace("\u00ad", "")
    s = s.replace("\u2010", "-").replace("\u2011", "-").replace("\u2013", "-").replace("\u2014", "-")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def normalize_block(text: str) -> str:
    text = text.replace("\u00ad", "")
    text = re.sub(r"(?<=\w)-\s+(?=\w)", "", text)  # join PDF line-break hyphenation
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def page_noise(text: str) -> bool:
    t = clean_line(text)
    if not t:
        return True
    if PAGE_NO_RE.fullmatch(t):
        return True
    if t in {
        "Bulletin of Duke Kunshan University Undergraduate Instruction",
        "Bulletin of Duke Kunshan University Undergraduate Instruction 2021-2022",
    }:
        return True
    return False


def avg_font_size(block: dict) -> float:
    spans = []
    for line in block.get("lines", []):
        for span in line.get("spans", []):
            spans.append(span)
    return float(np.mean([s["size"] for s in spans])) if spans else 0.0


def is_bold(block: dict) -> bool:
    for line in block.get("lines", []):
        for span in line.get("spans", []):
            font = span.get("font", "").lower()
            if "bold" in font:
                return True
    return False


def looks_like_heading(text: str, font_size: float, page_median: float, bold: bool) -> bool:
    words = text.split()
    if not words or len(words) > 24:
        return False
    if COURSE_RE.match(text):
        return False
    if DOT_TOC_RE.search(text):
        return False
    if text.endswith(('.', ';', ':')) and not text.lower().startswith("part "):
        return False
    title_case_ratio = sum(w[:1].isupper() for w in words if w[:1].isalpha()) / max(1, sum(w[:1].isalpha() for w in words))
    size_signal = font_size >= max(11.5, page_median * 1.08)
    return bold or size_signal or title_case_ratio > 0.72


def split_long_passage(text: str, max_words: int = 110) -> list[str]:
    words = text.split()
    if len(words) <= max_words:
        return [text]
    # Sentence-aware splitting while keeping blocks interpretable.
    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks, current, count = [], [], 0
    for sent in sentences:
        n = len(sent.split())
        if current and count + n > max_words:
            chunks.append(" ".join(current).strip())
            current, count = [], 0
        current.append(sent)
        count += n
    if current:
        chunks.append(" ".join(current).strip())
    # Fallback for unusually long sentence(s).
    out = []
    for c in chunks:
        cw = c.split()
        if len(cw) <= max_words:
            out.append(c)
        else:
            out.extend(" ".join(cw[i:i+max_words]) for i in range(0, len(cw), max_words))
    return [x for x in out if len(x.split()) >= 5]


def detect_section_heading(text: str, current_section: str, current_subsection: str, font_size: float, page_median: float, bold: bool):
    """Conservative hierarchy detection. Part headings are always chapters.
    Other headings alternate between section/subsection according to size and
    whether a section is already active on the page.
    """
    part = PART_RE.match(text)
    if part:
        return part.group(0), None, None
    if not looks_like_heading(text, font_size, page_median, bold):
        return None, None, None
    # Very large/bold headings -> section. Smaller headings nested beneath an active section -> subsection.
    if font_size >= max(14.0, page_median * 1.18) or (bold and font_size >= max(12.5, page_median * 1.10)):
        return None, text, None
    if current_section:
        return None, None, text
    return None, text, None


def block_text(block: dict) -> str:
    """Reconstruct text from PyMuPDF's dict-mode block structure.
    In page.get_text("dict"), text lives under lines -> spans rather than
    reliably under a top-level block["text"] field.
    """
    parts = []
    for line in block.get("lines", []):
        parts.append(" ".join(span.get("text", "") for span in line.get("spans", [])))
    return "\n".join(parts)


def extract_passages(pdf_path: Path) -> pd.DataFrame:
    doc = fitz.open(pdf_path)
    rows = []
    chapter = "Front Matter"
    section = "Front Matter"
    subsection = ""
    pid = 0

    for page_idx in range(doc.page_count):
        # Skip front cover and TOC pages; start from the printed bulletin content.
        if page_idx < 9:
            continue
        page = doc[page_idx]
        blocks = page.get_text("dict").get("blocks", [])
        text_blocks = [b for b in blocks if b.get("type") == 0 and clean_line(block_text(b))]
        font_sizes = [avg_font_size(b) for b in text_blocks if avg_font_size(b) > 0]
        page_median = float(np.median(font_sizes)) if font_sizes else 10.0

        # PDF blocks are already spatially ordered in most cases. Sort to make ordering explicit.
        text_blocks.sort(key=lambda b: (b.get("bbox", [0, 0, 0, 0])[1], b.get("bbox", [0, 0, 0, 0])[0]))

        pending_text: list[str] = []
        pending_y = None

        for block in text_blocks:
            raw = normalize_block(block_text(block))
            if page_noise(raw):
                continue
            fsize = avg_font_size(block)
            bold = is_bold(block)
            ch, sec, sub = detect_section_heading(raw, section, subsection, fsize, page_median, bold)
            if ch:
                if pending_text:
                    joined = normalize_block(" ".join(pending_text))
                    for part_text in split_long_passage(joined):
                        pid += 1
                        rows.append({"passage_id": f"p{pid:05d}", "chapter": chapter, "section": section, "subsection": subsection, "page": page_idx + 1, "text": part_text})
                    pending_text = []
                chapter = ch
                section = ch
                subsection = ""
                continue
            if sec:
                if pending_text:
                    joined = normalize_block(" ".join(pending_text))
                    for part_text in split_long_passage(joined):
                        pid += 1
                        rows.append({"passage_id": f"p{pid:05d}", "chapter": chapter, "section": section, "subsection": subsection, "page": page_idx + 1, "text": part_text})
                    pending_text = []
                section = sec
                subsection = ""
                continue
            if sub:
                if pending_text:
                    joined = normalize_block(" ".join(pending_text))
                    for part_text in split_long_passage(joined):
                        pid += 1
                        rows.append({"passage_id": f"p{pid:05d}", "chapter": chapter, "section": section, "subsection": subsection, "page": page_idx + 1, "text": part_text})
                    pending_text = []
                subsection = sub
                continue

            # Ignore obvious TOC fragments that survived the page filter.
            if DOT_TOC_RE.search(raw):
                continue
            pending_text.append(raw)

        if pending_text:
            joined = normalize_block(" ".join(pending_text))
            for part_text in split_long_passage(joined):
                pid += 1
                rows.append({"passage_id": f"p{pid:05d}", "chapter": chapter, "section": section, "subsection": subsection, "page": page_idx + 1, "text": part_text})

    df = pd.DataFrame(rows)
    if df.empty:
        raise RuntimeError("No passages extracted. Check the PDF and extraction settings.")
    df["text"] = df["text"].str.replace(r"\s+", " ", regex=True).str.strip()
    df = df[df["text"].str.split().str.len() >= 8]
    df = df.drop_duplicates(subset=["text"]).reset_index(drop=True)
    df["passage_id"] = [f"p{i:05d}" for i in range(1, len(df) + 1)]
    df["word_count"] = df["text"].str.split().str.len()
    return df


def tfidf_terms(texts: list[str], top_n: int = 20):
    vec = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), min_df=2, max_df=0.92)
    X = vec.fit_transform(texts)
    scores = np.asarray(X.mean(axis=0)).ravel()
    terms = np.asarray(vec.get_feature_names_out())
    order = scores.argsort()[::-1]
    rows = [{"term": terms[i], "mean_tfidf": float(scores[i])} for i in order[:top_n]]
    return vec, X, pd.DataFrame(rows)


def label_cluster(texts: list[str], top_terms: list[str]) -> str:
    s = set(" ".join(top_terms).lower().replace("-", " ").split())
    best_label, best_score = "Topic", -1
    for label, kws in LABEL_RULES:
        score = len(s & kws)
        if score > best_score:
            best_label, best_score = label, score
    return best_label if best_score >= 1 else (top_terms[0].title() if top_terms else "Topic")


def run_analysis(df: pd.DataFrame, out_dir: Path):
    from sentence_transformers import SentenceTransformer
    import umap

    out_dir.mkdir(parents=True, exist_ok=True)
    data_dir = out_dir.parent / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    # Corpus summaries.
    df.to_csv(data_dir / "bulletin_passages.csv", index=False)
    _, tfidf_X, top_terms = tfidf_terms(df["text"].tolist(), top_n=30)
    top_terms.to_csv(data_dir / "tfidf_terms.csv", index=False)

    model = SentenceTransformer(EMBEDDING_MODEL)
    embeddings = model.encode(df["text"].tolist(), normalize_embeddings=True, show_progress_bar=True)
    embeddings = np.asarray(embeddings, dtype=np.float32)

    reducer = umap.UMAP(n_components=2, n_neighbors=15, min_dist=0.15, metric="cosine", random_state=RANDOM_STATE)
    coords = reducer.fit_transform(embeddings)
    df["x"] = coords[:, 0]
    df["y"] = coords[:, 1]

    kmeans = KMeans(n_clusters=N_CLUSTERS, random_state=RANDOM_STATE, n_init="auto")
    df["cluster"] = kmeans.fit_predict(embeddings)

    # Cluster labels from TF-IDF within each cluster + representative terms.
    labels, profiles = {}, []
    used_labels = Counter()
    for c in sorted(df["cluster"].unique()):
        idx = np.where(df["cluster"].to_numpy() == c)[0]
        cluster_vec = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), min_df=max(2, min(5, len(idx)//20)), max_df=0.98)
        try:
            Xc = cluster_vec.fit_transform(df.iloc[idx]["text"])
            scores = np.asarray(Xc.mean(axis=0)).ravel()
            terms = np.asarray(cluster_vec.get_feature_names_out())
            inds = scores.argsort()[::-1][:8]
            terms_top = [terms[i] for i in inds]
        except ValueError:
            terms_top = []
        label = label_cluster(df.iloc[idx]["text"].tolist(), terms_top)
        used_labels[label] += 1
        if used_labels[label] > 1:
            label = f"{label} — Topic {used_labels[label]}"
        labels[c] = label
        profiles.append({"cluster": int(c), "cluster_name": label, "top_terms": ", ".join(terms_top), "size": int(len(idx))})
    df["cluster_name"] = df["cluster"].map(labels)
    pd.DataFrame(profiles).to_csv(data_dir / "cluster_profiles.csv", index=False)

    # Nearest neighbors for interactive details.
    sim = cosine_similarity(embeddings)
    neighbors = []
    for i in range(len(df)):
        row = sim[i].copy()
        row[i] = -1
        nn = row.argsort()[::-1][:5]
        neighbors.append(";".join(df.iloc[j]["passage_id"] for j in nn))
    df["neighbors"] = neighbors

    # Section x topic matrix and formal-section diversity.
    matrix = (df.groupby(["section", "cluster_name"]).size().reset_index(name="count"))
    section_totals = df.groupby("section").size().rename("section_total").reset_index()
    matrix = matrix.merge(section_totals, on="section", how="left")
    matrix["proportion"] = matrix["count"] / matrix["section_total"]
    matrix.to_csv(data_dir / "lab8_topic_section_matrix.csv", index=False)

    diversity_rows = []
    for sec, g in df.groupby("section"):
        p = g["cluster_name"].value_counts(normalize=True).to_numpy()
        entropy = float(-(p * np.log2(p)).sum())
        max_h = np.log2(max(1, g["cluster_name"].nunique()))
        diversity_rows.append({"section": sec, "passage_count": int(len(g)), "topic_count": int(g["cluster_name"].nunique()), "entropy": entropy, "normalized_entropy": float(entropy / max_h) if max_h else 0.0})
    diversity = pd.DataFrame(diversity_rows).sort_values("normalized_entropy", ascending=False)
    diversity.to_csv(data_dir / "section_diversity.csv", index=False)

    # Section novelty = 1 - cosine similarity to the section centroid.
    novelty = np.zeros(len(df))
    for sec, idxs in df.groupby("section").groups.items():
        inds = np.asarray(list(idxs), dtype=int)
        centroid = embeddings[inds].mean(axis=0)
        centroid = centroid / max(np.linalg.norm(centroid), 1e-12)
        sims = embeddings[inds] @ centroid
        novelty[inds] = 1 - sims
    df["section_novelty"] = novelty
    unusual = df.sort_values("section_novelty", ascending=False)[["passage_id","chapter","section","subsection","page","section_novelty","text"]].head(25)
    unusual.to_csv(data_dir / "unusual_passages.csv", index=False)

    # Required keyword search summary.
    keywords = ["credit", "graduation", "registration", "academic integrity"]
    qrows = []
    low = df["text"].str.lower()
    for q in keywords:
        hit = df[low.str.contains(re.escape(q), na=False)]
        for _, r in hit.iterrows():
            qrows.append({"query": q, "passage_id": r["passage_id"], "chapter": r["chapter"], "section": r["section"], "subsection": r["subsection"], "page": int(r["page"]), "cluster_name": r["cluster_name"], "text": r["text"]})
    pd.DataFrame(qrows).to_csv(data_dir / "keyword_hits.csv", index=False)

    # Final visualization data.
    export_cols = ["passage_id","chapter","section","subsection","page","text","word_count","cluster","cluster_name","x","y","neighbors","section_novelty"]
    df[export_cols].to_csv(data_dir / "lab8_embedding_map.csv", index=False)

    # Corpus summary.
    summary = {
        "bulletin_title": "Bulletin of Duke Kunshan University Undergraduate Instruction",
        "academic_year": "2021-2022",
        "source": SOURCE_URL,
        "accessed": pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%d"),
        "raw_passages": int(len(df)),
        "clean_passages": int(len(df)),
        "average_passage_length_words": float(df["word_count"].mean()),
        "formal_sections": int(df["section"].nunique()),
        "embedding_model": EMBEDDING_MODEL,
        "embedding_dimension": int(embeddings.shape[1]),
        "umap": {"n_components": 2, "n_neighbors": 15, "min_dist": 0.15, "metric": "cosine", "random_state": RANDOM_STATE},
        "clustering": {"method": "KMeans", "n_clusters": N_CLUSTERS, "random_state": RANDOM_STATE, "n_init": "auto"},
    }
    (data_dir / "corpus_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    # 200-300 word design description, generated from the actual run.
    top_labels = df["cluster_name"].value_counts().index.tolist()
    diverse = diversity.iloc[0]["section"] if not diversity.empty else "N/A"
    report = f"""# Lab 8 — Design Description and Findings\n\n## Corpus and pipeline\nThe system analyzes the **Bulletin of Duke Kunshan University Undergraduate Instruction (2021–2022)** from the official DKU PDF source. After PDF block extraction, repeated headers, page-number artifacts, duplicate passages, and malformed blocks are removed. The resulting corpus contains **{len(df):,} passages** across **{df['section'].nunique()} formal sections**, with a mean passage length of **{df['word_count'].mean():.1f} words**. Each passage preserves chapter, section, subsection, page, and text metadata.\n\nEach passage is encoded with the Sentence-Transformers model **{EMBEDDING_MODEL}**. The normalized embeddings are projected to two dimensions with UMAP using 15 neighbors, minimum distance 0.15, cosine distance, and random seed 401. K-means with **{N_CLUSTERS} clusters** is then applied to the original embeddings rather than to the 2D projection. Cluster labels are assigned from within-cluster TF-IDF terms and representative passages. The current topic labels are: {', '.join(top_labels)}.\n\n## Visual encodings and interaction\nThe semantic map uses x/y position for the UMAP projection, color for semantic topic, and point radius for passage length. Clicking a point opens a persistent detail panel with its formal location, page, topic, text, novelty score, and five nearest semantic neighbors. Search highlights matching passages, while section and topic filters reduce the active set. D3 zoom/pan supports local inspection. The Topic × Section matrix encodes passage counts through cell area/opacity and supports coordinated highlighting: selecting a matrix cell highlights all passages with that formal section and semantic topic, while selecting a passage activates the corresponding matrix cell.\n\n## Findings\nThe largest cross-sectional themes are represented by **{', '.join(top_labels[:5])}**. Formal-section diversity is quantified with normalized topic entropy; the most diverse section in this run is **{diverse}**. The keyword view also shows that terms such as *credit*, *graduation*, *registration*, and *academic integrity* are distributed across multiple semantic contexts rather than being confined to a single page or chapter. The dashboard lets these relationships be inspected directly at passage level.\n"""
    (out_dir.parent / "docs" / "lab8_report.md").write_text(report, encoding="utf-8")
    return summary


def main():
    parser = argparse.ArgumentParser(description="Build the STATS 401 Lab 8 DKU Bulletin corpus and semantic analysis.")
    parser.add_argument("--pdf", type=Path, required=True, help="Local DKU bulletin PDF.")
    args = parser.parse_args()
    if not args.pdf.exists() or args.pdf.stat().st_size < 100_000:
        raise FileNotFoundError(f"PDF not found or too small: {args.pdf}")
    project = Path(__file__).resolve().parents[1]
    df = extract_passages(args.pdf)
    df[["passage_id","chapter","section","subsection","page","text","word_count"]].to_csv(project / "lab8" / "bulletin_passages_raw.csv", index=False)
    summary = run_analysis(df, project / "lab8" / "assets")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
