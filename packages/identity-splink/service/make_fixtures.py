"""Generate a synthetic labeled dataset for exercising the resolver.

Creates fixtures/records.csv (~260 rows: 200 distinct people, 60 fuzzy
duplicates) and fixtures/labels.csv (every duplicate pair labeled 1, plus an
equal number of hard negative pairs labeled 0). Deterministic via a fixed seed.
This exercises the pipeline; the official Phase 2 proof runs on Steve's
labeled sample of real data.
"""

import csv
import pathlib
import random

random.seed(42)

FIRST = ["Robert", "James", "Maria", "Linda", "Michael", "Sarah", "David", "Jennifer",
         "William", "Karen", "Carlos", "Susan", "Thomas", "Nancy", "Miguel", "Laura",
         "Daniel", "Amy", "Steven", "Angela"]
NICK = {"Robert": "Bob", "James": "Jim", "Michael": "Mike", "William": "Bill",
        "Thomas": "Tom", "Daniel": "Dan", "Steven": "Steve", "Jennifer": "Jen"}
LAST = ["Smith", "Johnson", "Garcia", "Miller", "Davis", "Martinez", "Lopez", "Wilson",
        "Anderson", "Taylor", "Moore", "Jackson", "Lee", "Nguyen", "Patel", "Kim",
        "Brown", "Walker", "Young", "Hall"]
CITIES = [("Plano", "TX"), ("Dallas", "TX"), ("Frisco", "TX"), ("Austin", "TX"),
          ("Tulsa", "OK"), ("Miami", "FL"), ("Tampa", "FL"), ("Denver", "CO"),
          ("Phoenix", "AZ"), ("Atlanta", "GA")]
DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "example.com"]


def person(i: int) -> dict:
    first, last = random.choice(FIRST), random.choice(LAST)
    city, state = random.choice(CITIES)
    phone = f"+1214555{i:04d}"
    email = f"{first.lower()}.{last.lower()}{i}@{random.choice(DOMAINS)}"
    return {"id": f"p{i}", "full_name": f"{first} {last}", "email": email,
            "phone": phone, "city": city, "state": state, "_first": first, "_last": last}


def variant(p: dict, j: int) -> dict:
    first = NICK.get(p["_first"], p["_first"][:1] + ".") if j % 2 == 0 else p["_first"]
    email = f"{first.lower().rstrip('.')}{p['_last'].lower()}@{random.choice(DOMAINS)}"
    keep_phone = j % 3 != 0
    return {"id": f"{p['id']}d{j}", "full_name": f"{first} {p['_last']}", "email": email,
            "phone": p["phone"] if keep_phone else "", "city": p["city"], "state": p["state"]}


def main() -> None:
    out = pathlib.Path(__file__).parent / "fixtures"
    out.mkdir(exist_ok=True)

    people = [person(i) for i in range(2000)]
    dupes, labels = [], []
    for j, p in enumerate(random.sample(people, 300)):
        d = variant(p, j)
        dupes.append(d)
        labels.append({"left_id": p["id"], "right_id": d["id"], "is_same": 1})

    # hard negatives: same last name + same state, different people
    negatives = 0
    for a in people:
        if negatives >= 300:
            break
        for b in people:
            if a["id"] >= b["id"]:
                continue
            if a["_last"] == b["_last"] and a["state"] == b["state"] and a["_first"] != b["_first"]:
                labels.append({"left_id": a["id"], "right_id": b["id"], "is_same": 0})
                negatives += 1
                break

    rows = [{k: v for k, v in r.items() if not k.startswith("_")} for r in people + dupes]
    with open(out / "records.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["id", "full_name", "email", "phone", "city", "state"])
        w.writeheader()
        w.writerows(rows)
    with open(out / "labels.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["left_id", "right_id", "is_same"])
        w.writeheader()
        w.writerows(labels)
    print(f"wrote {len(rows)} records, {len(labels)} labeled pairs ({negatives} negatives)")


if __name__ == "__main__":
    main()
