#!/usr/bin/env python3
"""
Fetch latest mechanistic interpretability papers from arXiv and other sources.
Updates data/papers.json with new entries.
"""

import json
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
import os
import re
import time

# Configuration
PAPERS_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'papers.json')
MAX_RESULTS = 50
DAYS_LOOKBACK = 30

# arXiv categories and search terms for mechanistic interpretability
ARXIV_QUERIES = [
    'all:"mechanistic interpretability"',
    'all:"sparse autoencoder" AND all:interpretability',
    'all:"transformer circuits"',
    'all:superposition AND all:neural AND all:interpretability',
    'all:"activation patching"',
    'all:"feature visualization" AND all:transformer',
    'all:probing AND all:"language model" AND all:interpretability',
]


def fetch_arxiv_papers(query: str, max_results: int = 20) -> list:
    """Fetch papers from arXiv API."""
    base_url = 'http://export.arxiv.org/api/query?'

    params = {
        'search_query': query,
        'start': 0,
        'max_results': max_results,
        'sortBy': 'submittedDate',
        'sortOrder': 'descending'
    }

    url = base_url + urllib.parse.urlencode(params)

    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            data = response.read().decode('utf-8')
    except Exception as e:
        print(f"Error fetching from arXiv: {e}")
        return []

    # Parse XML
    root = ET.fromstring(data)
    ns = {'atom': 'http://www.w3.org/2005/Atom', 'arxiv': 'http://arxiv.org/schemas/atom'}

    papers = []
    for entry in root.findall('atom:entry', ns):
        try:
            # Extract paper ID
            id_elem = entry.find('atom:id', ns)
            if id_elem is None:
                continue
            arxiv_id = id_elem.text.split('/abs/')[-1]

            # Extract title
            title_elem = entry.find('atom:title', ns)
            title = title_elem.text.strip().replace('\n', ' ') if title_elem is not None else ""

            # Extract authors
            authors = []
            for author in entry.findall('atom:author', ns):
                name = author.find('atom:name', ns)
                if name is not None:
                    authors.append(name.text)
            authors_str = ', '.join(authors[:5])
            if len(authors) > 5:
                authors_str += ', et al.'

            # Extract abstract
            summary_elem = entry.find('atom:summary', ns)
            abstract = summary_elem.text.strip().replace('\n', ' ')[:500] if summary_elem is not None else ""

            # Extract date
            published_elem = entry.find('atom:published', ns)
            if published_elem is not None:
                date_str = published_elem.text[:10]  # YYYY-MM-DD
            else:
                date_str = datetime.now().strftime('%Y-%m-%d')

            # Extract categories/tags
            tags = []
            for category in entry.findall('atom:category', ns):
                term = category.get('term', '')
                if term and term.startswith('cs.'):
                    tags.append(term)

            # Add relevant tags based on content
            title_lower = title.lower()
            abstract_lower = abstract.lower()
            content = title_lower + ' ' + abstract_lower

            if 'sparse autoencoder' in content or 'sae' in content:
                tags.append('SAE')
            if 'circuit' in content:
                tags.append('circuits')
            if 'superposition' in content:
                tags.append('superposition')
            if 'feature' in content and 'interpret' in content:
                tags.append('features')
            if 'safety' in content or 'alignment' in content:
                tags.append('safety')
            if 'survey' in content or 'review' in content:
                tags.append('survey')

            # Remove duplicates and limit tags
            tags = list(dict.fromkeys(tags))[:5]

            papers.append({
                'id': f'arxiv-{arxiv_id.replace("/", "-").replace(".", "-")}',
                'title': title,
                'authors': authors_str,
                'date': date_str,
                'url': f'https://arxiv.org/abs/{arxiv_id}',
                'abstract': abstract,
                'tags': tags,
                'source': 'arXiv'
            })
        except Exception as e:
            print(f"Error parsing entry: {e}")
            continue

    return papers


def load_existing_papers() -> dict:
    """Load existing papers from JSON file."""
    try:
        with open(PAPERS_FILE, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        return {'lastUpdated': '', 'papers': []}


def save_papers(data: dict):
    """Save papers to JSON file."""
    with open(PAPERS_FILE, 'w') as f:
        json.dump(data, f, indent=2)


def merge_papers(existing: list, new: list) -> list:
    """Merge new papers with existing, avoiding duplicates."""
    # Create a set of existing paper IDs and URLs for deduplication
    existing_ids = {p.get('id', '') for p in existing}
    existing_urls = {p.get('url', '') for p in existing}
    existing_titles = {p.get('title', '').lower().strip() for p in existing}

    merged = list(existing)
    added_count = 0

    for paper in new:
        paper_id = paper.get('id', '')
        paper_url = paper.get('url', '')
        paper_title = paper.get('title', '').lower().strip()

        # Skip if already exists
        if paper_id in existing_ids or paper_url in existing_urls:
            continue

        # Skip if title is too similar to existing
        if paper_title in existing_titles:
            continue

        merged.append(paper)
        existing_ids.add(paper_id)
        existing_urls.add(paper_url)
        existing_titles.add(paper_title)
        added_count += 1

    print(f"Added {added_count} new papers")

    # Sort by date (newest first)
    merged.sort(key=lambda x: x.get('date', ''), reverse=True)

    return merged


def is_relevant_paper(paper: dict) -> bool:
    """Check if paper is relevant to mechanistic interpretability."""
    title = paper.get('title', '').lower()
    abstract = paper.get('abstract', '').lower()
    content = title + ' ' + abstract

    # Must have interpretability-related terms
    interp_terms = ['interpretab', 'explain', 'understand', 'circuit', 'mechanis']
    has_interp = any(term in content for term in interp_terms)

    # Must have ML/neural network terms
    ml_terms = ['neural', 'transformer', 'language model', 'llm', 'gpt', 'bert', 'attention']
    has_ml = any(term in content for term in ml_terms)

    # Bonus terms that strongly indicate relevance
    bonus_terms = ['sparse autoencoder', 'sae', 'superposition', 'polysemant',
                   'monosemant', 'activation patching', 'probing', 'feature']
    has_bonus = any(term in content for term in bonus_terms)

    return (has_interp and has_ml) or has_bonus


def main():
    print("Fetching mechanistic interpretability papers...")

    all_new_papers = []

    for query in ARXIV_QUERIES:
        print(f"Querying: {query}")
        papers = fetch_arxiv_papers(query, max_results=MAX_RESULTS // len(ARXIV_QUERIES))

        # Filter for relevance
        relevant_papers = [p for p in papers if is_relevant_paper(p)]
        all_new_papers.extend(relevant_papers)

        # Rate limiting
        time.sleep(3)

    print(f"Found {len(all_new_papers)} potentially relevant papers")

    # Load existing and merge
    existing_data = load_existing_papers()
    existing_papers = existing_data.get('papers', [])

    merged_papers = merge_papers(existing_papers, all_new_papers)

    # Update data
    existing_data['papers'] = merged_papers
    existing_data['lastUpdated'] = datetime.now().strftime('%Y-%m-%d')

    # Save
    save_papers(existing_data)
    print(f"Saved {len(merged_papers)} total papers")


if __name__ == '__main__':
    main()
