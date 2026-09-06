import re
from pathlib import Path
import pandas as pd
import nltk
from nltk.corpus import stopwords
from nltk.stem import WordNetLemmatizer
from sklearn.feature_extraction.text import CountVectorizer, TfidfVectorizer
from transformers import pipeline

BASE = Path(__file__).resolve().parent.parent
RAW = BASE / "data" / "lab4_raw_tweets.csv"
OUT = BASE / "data" / "lab4_clean_tweets.csv"
TFIDF_OUT = BASE / "data" / "tfidf_top_terms.csv"
REPORT_OUT = BASE / "data" / "data_quality_report.txt"

for resource, package in [("tokenizers/punkt", "punkt"), ("tokenizers/punkt_tab", "punkt_tab"), ("corpora/stopwords", "stopwords"), ("corpora/wordnet", "wordnet"), ("corpora/omw-1.4", "omw-1.4")]:
    try: nltk.data.find(resource)
    except LookupError: nltk.download(package, quiet=True)

df = pd.read_csv(RAW, low_memory=False)
original_rows = len(df)
missing_before = df.isna().sum().to_dict()
duplicate_before = int(df.duplicated().sum())

if "text" not in df.columns: raise ValueError("The raw file must contain a 'text' column.")
df["text"] = df["text"].astype("string").str.replace(r"\s+", " ", regex=True).str.strip()
df = df.dropna(subset=["text"])
df = df[df["text"].ne("")]
df = df.drop_duplicates(subset=["text"], keep="first")

if "date" in df.columns: df["date"] = pd.to_datetime(df["date"], errors="coerce", format="mixed")
if "user_created" in df.columns: df["user_created"] = pd.to_datetime(df["user_created"], errors="coerce", format="mixed")
for col in ["user_followers", "user_friends", "user_favourites"]:
    if col in df.columns:
        df[col] = pd.to_numeric(df[col], errors="coerce")
        df.loc[df[col] < 0, col] = pd.NA
for col in ["user_name", "user_location", "source"]:
    if col in df.columns: df[col] = df[col].astype("string").str.strip()
if "user_verified" in df.columns: df["user_verified"] = df["user_verified"].astype("boolean")
if "is_retweet" in df.columns: df["is_retweet"] = df["is_retweet"].astype("boolean")

stop_words = set(stopwords.words("english"))
lemmatizer = WordNetLemmatizer()

def normalize_tweet(text):
    text = str(text).lower()
    text = re.sub(r"https?://\S+|www\.\S+", " URL ", text)
    text = re.sub(r"@\w+", " USER ", text)
    text = re.sub(r"\b\d+(?:\.\d+)?\b", " NUMBER ", text)
    return re.sub(r"\s+", " ", text).strip()

def clean_tokens(text):
    tokens = nltk.word_tokenize(normalize_tweet(text))
    return [lemmatizer.lemmatize(t) for t in tokens if t.isalpha() and t not in stop_words]

df["tweet_text_raw"] = df["text"]
df["text_normalized"] = df["text"].apply(normalize_tweet)
df["tokens_clean"] = df["text"].apply(clean_tokens)
df["text_clean"] = df["tokens_clean"].apply(" ".join)

vectorizer = CountVectorizer(min_df=2, max_df=0.90)
dtm = vectorizer.fit_transform(df["text_clean"])
tfidf_vectorizer = TfidfVectorizer(min_df=2, max_df=0.90)
tfidf = tfidf_vectorizer.fit_transform(df["text_clean"])
terms = tfidf_vectorizer.get_feature_names_out()
top_rows = []
for i, row in enumerate(tfidf):
    pairs = sorted(zip(row.indices, row.data), key=lambda x: x[1], reverse=True)[:5]
    top_rows.extend({"row": i, "term": terms[idx], "tfidf": float(score)} for idx, score in pairs)
pd.DataFrame(top_rows).to_csv(TFIDF_OUT, index=False)

def prepare_for_roberta(text):
    text = re.sub(r"@\w+", "@user", str(text))
    text = re.sub(r"https?://\S+|www\.\S+", "http", text)
    return text.strip()

df["sentiment_text"] = df["tweet_text_raw"].apply(prepare_for_roberta)
model = pipeline("sentiment-analysis", model="cardiffnlp/twitter-roberta-base-sentiment-latest", top_k=None)
results = model(df["sentiment_text"].tolist(), truncation=True, batch_size=16)
score_dicts = [{x["label"].lower(): float(x["score"]) for x in scores} for scores in results]
df["sentiment_negative"] = [x.get("negative", 0.0) for x in score_dicts]
df["sentiment_neutral"] = [x.get("neutral", 0.0) for x in score_dicts]
df["sentiment_positive"] = [x.get("positive", 0.0) for x in score_dicts]
df["sentiment"] = [max(x, key=x.get).capitalize() for x in score_dicts]
df["sentiment_score"] = df["sentiment_positive"] - df["sentiment_negative"]

if "date" in df.columns:
    df["tweet_date"] = df["date"].dt.date
    df["hour"] = df["date"].dt.hour
    df["weekday"] = df["date"].dt.day_name()

preferred = ["tweet_text_raw","date","tweet_date","hour","weekday","user_name","user_location","user_followers","user_friends","user_favourites","user_verified","hashtags","source","is_retweet","text_clean","sentiment_negative","sentiment_neutral","sentiment_positive","sentiment_score","sentiment"]
available = [c for c in preferred if c in df.columns]
extra = [c for c in df.columns if c not in available and c not in {"text","tokens_clean","text_normalized","sentiment_text"}]
vis_df = df[available + extra].copy()

OUT.parent.mkdir(parents=True, exist_ok=True)
vis_df.to_csv(OUT, index=False)
with open(REPORT_OUT, "w", encoding="utf-8") as f:
    f.write(f"Original rows: {original_rows}\nRows after cleaning: {len(vis_df)}\nExact duplicate rows before cleaning: {duplicate_before}\n\nMissing values before cleaning:\n")
    f.write("\n".join(f"  {k}: {v}" for k, v in missing_before.items()))
    f.write("\n\nMissing values after cleaning:\n")
    f.write("\n".join(f"  {k}: {int(v)}" for k, v in vis_df.isna().sum().items()))
    f.write("\n\nSentiment counts:\n" + vis_df["sentiment"].value_counts().to_string())

print(f"Saved cleaned data: {OUT}")
print(f"Rows: {len(vis_df):,}")
print(vis_df["sentiment"].value_counts())
