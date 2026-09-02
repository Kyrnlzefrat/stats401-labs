import requests
import time
import re
import pandas as pd
from bs4 import BeautifulSoup
BASE_URL = "https://books.toscrape.com/catalogue/page-{}.html"
START_PAGE = 1
END_PAGE = 50
OUTPUT_FILE = "data/lab3_data.csv"
HEADERS = {"User-Agent": "STATS401-Class-Exercise/1.0"}
DELAY = 1
records = []
for page in range(START_PAGE, END_PAGE + 1):
    url = BASE_URL.format(page)
    print(f"Downloading page {page}: {url}")
    try:
        response = requests.get(url, headers=HEADERS, timeout=10)
        response.raise_for_status()
    except requests.RequestException as error:
        print(f"Failed to download page {page}: {error}")
        continue
    soup = BeautifulSoup(response.text, "html.parser")
    books = soup.select("article.product_pod")
    print(f"Found {len(books)} books")
    for book in books:
        title_element = book.select_one("h3 a")
        title = title_element["title"]
        price_element = book.select_one(".price_color")
        price_text = price_element.get_text(strip=True)
        price = float(re.sub(r"[^\d.]", "", price_text))
        #print(price_text, price)
        rating_element = book.select_one("p.star-rating")
        rating_classes = rating_element.get("class", [])
        rating_map = {
            "One": 1,
            "Two": 2,
            "Three": 3,
            "Four": 4,
            "Five": 5
        }
        rating = None
        for class_name in rating_classes:
            if class_name in rating_map:
                rating = rating_map[class_name]
                break
        availability_element = book.select_one(".availability")
        availability = availability_element.get_text(" ", strip=True)
        link_element = book.select_one("h3 a")
        relative_url = link_element["href"]
        book_url = (
            "https://books.toscrape.com/catalogue/"
            + relative_url.split("../")[-1]
        )
        records.append({
            "id": len(records) + 1,
            "title": title,
            "price": price,
            "rating": rating,
            "availability": availability,
            "url": book_url,
            "page": page
        })
    time.sleep(DELAY)
df = pd.DataFrame(records)
print()
print("=" * 60)
print(f"Total records collected: {len(df)}")
print("=" * 60)
if len(df) < 1000:
    raise RuntimeError(
        f"Only {len(df)} records were collected. "
        "The assignment requires at least 1,000 records."
    )
df.to_csv(OUTPUT_FILE, index=False)
print(f"Dataset saved to: {OUTPUT_FILE}")
print("First five records:")
print(df.head())
print("Dataset information:")
print(df.info())