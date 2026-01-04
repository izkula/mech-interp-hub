#!/usr/bin/env python3
"""
Fetch latest mechanistic interpretability papers from multiple sources.
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
MAX_RESULTS_PER_QUERY = 30
DAYS_LOOKBACK = 60  # Look back 2 months

# Comprehensive arXiv search queries
ARXIV_QUERIES = [
    # Core MI terms
    'all:"mechanistic interpretability"',
    'all:"sparse autoencoder" AND all:language',
    'all:"sparse autoencoders" AND all:interpretability',
    'all:"transformer circuits"',
    'all:"circuit analysis" AND all:transformer',

    # Superposition and features
    'all:superposition AND all:"neural network" AND all:interpretability',
    'all:polysemantic AND all:neuron',
    'all:monosemantic AND all:feature',

    # Techniques
    'all:"activation patching"',
    'all:"causal tracing" AND all:language',
    'all:"logit lens"',
    'all:"probing classifier" AND all:transformer',
    'all:"linear probe" AND all:"language model"',

    # Feature work
    'all:"feature steering" AND all:language',
    'all:"representation engineering"',
    'all:"concept erasure" AND all:model',
    'all:"feature visualization" AND all:transformer',

    # Safety-related
    'all:interpretability AND all:alignment AND all:safety',
    'all:"model editing" AND all:knowledge',

    # Dictionary learning
    'all:"dictionary learning" AND all:transformer',
    'all:transcoder AND all:interpretability',
    'all:crosscoder',

    # Specific architectures
    'all:SAE AND all:LLM AND all:feature',
    'all:"attention head" AND all:interpretability',
]

# Semantic Scholar search queries (uses different syntax)
SEMANTIC_SCHOLAR_QUERIES = [
    "mechanistic interpretability language models",
    "sparse autoencoder interpretability",
    "transformer circuit analysis",
]

# RSS/Atom feeds to check
RSS_FEEDS = [
    {
        "name": "Anthropic Research",
        "url": "https://www.anthropic.com/research/rss.xml",
        "filter_terms": ["interpret", "circuit", "feature", "mechanistic"]
    },
]


def fetch_arxiv_papers(query: str, max_results: int = 30) -> list:
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
        req = urllib.request.Request(url, headers={'User-Agent': 'MechInterpHub/1.0'})
        with urllib.request.urlopen(req, timeout=30) as response:
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

            # Check if paper is recent enough
            paper_date = datetime.strptime(date_str, '%Y-%m-%d')
            cutoff_date = datetime.now() - timedelta(days=DAYS_LOOKBACK)
            if paper_date < cutoff_date:
                continue

            # Extract and generate tags
            tags = generate_tags(title, abstract)

            papers.append({
                'id': f'arxiv-{arxiv_id.replace("/", "-").replace(".", "-")}',
                'title': title,
                'authors': authors_str,
                'date': date_str,
                'url': f'https://arxiv.org/abs/{arxiv_id}',
                'abstract': abstract,
                'tags': tags,
                'source': 'arXiv',
                'featured': False  # Auto-fetched papers aren't featured by default
            })
        except Exception as e:
            print(f"Error parsing entry: {e}")
            continue

    return papers


def fetch_semantic_scholar(query: str, limit: int = 20) -> list:
    """Fetch papers from Semantic Scholar API."""
    base_url = 'https://api.semanticscholar.org/graph/v1/paper/search'

    params = {
        'query': query,
        'limit': limit,
        'fields': 'title,authors,abstract,url,publicationDate,externalIds',
        'year': f'{datetime.now().year - 1}-{datetime.now().year}'
    }

    url = base_url + '?' + urllib.parse.urlencode(params)

    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'MechInterpHub/1.0',
        })
        with urllib.request.urlopen(req, timeout=30) as response:
            data = json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f"Error fetching from Semantic Scholar: {e}")
        return []

    papers = []
    for paper in data.get('data', []):
        try:
            if not paper.get('title') or not paper.get('publicationDate'):
                continue

            # Get arXiv ID if available
            external_ids = paper.get('externalIds', {})
            arxiv_id = external_ids.get('ArXiv')

            # Skip if we'll get this from arXiv directly
            if arxiv_id:
                continue

            authors = [a.get('name', '') for a in paper.get('authors', [])[:5]]
            if len(paper.get('authors', [])) > 5:
                authors.append('et al.')

            abstract = paper.get('abstract', '')[:500] if paper.get('abstract') else ''

            papers.append({
                'id': f'ss-{paper.get("paperId", "")[:20]}',
                'title': paper.get('title', ''),
                'authors': ', '.join(authors),
                'date': paper.get('publicationDate', ''),
                'url': paper.get('url', ''),
                'abstract': abstract,
                'tags': generate_tags(paper.get('title', ''), abstract),
                'source': 'Semantic Scholar',
                'featured': False
            })
        except Exception as e:
            print(f"Error parsing SS entry: {e}")
            continue

    return papers


def generate_tags(title: str, abstract: str) -> list:
    """Generate relevant tags based on content."""
    tags = []
    content = (title + ' ' + abstract).lower()

    tag_keywords = {
        'SAE': ['sparse autoencoder', 'sae ', 'saes'],
        'circuits': ['circuit', 'computational graph'],
        'superposition': ['superposition'],
        'features': ['feature', 'monosemantic', 'polysemantic'],
        'safety': ['safety', 'alignment', 'harmful'],
        'probing': ['probe', 'probing', 'classifier'],
        'attention': ['attention head', 'attention pattern'],
        'steering': ['steering', 'activation engineering'],
        'editing': ['model editing', 'knowledge editing'],
        'survey': ['survey', 'review', 'overview'],
        'theory': ['theoretical', 'theory', 'mathematical framework'],
        'vision': ['vision', 'visual', 'multimodal', 'image'],
        'biology': ['protein', 'dna', 'biological', 'biology'],
        'reasoning': ['reasoning', 'chain-of-thought', 'cot'],
    }

    for tag, keywords in tag_keywords.items():
        if any(kw in content for kw in keywords):
            tags.append(tag)

    return list(dict.fromkeys(tags))[:6]  # Dedupe and limit


def is_relevant_paper(paper: dict) -> bool:
    """Check if paper is relevant to mechanistic interpretability."""
    title = paper.get('title', '').lower()
    abstract = paper.get('abstract', '').lower()
    content = title + ' ' + abstract

    # Strong indicators - if present, paper is relevant
    strong_terms = [
        'mechanistic interpretability', 'sparse autoencoder', 'transformer circuit',
        'activation patching', 'superposition', 'monosemantic', 'polysemantic',
        'feature steering', 'probing classifier', 'logit lens', 'transcoder',
        'crosscoder', 'representation engineering', 'causal tracing'
    ]
    if any(term in content for term in strong_terms):
        return True

    # Must have interpretability-related terms
    interp_terms = ['interpretab', 'explain', 'understand', 'circuit', 'mechanis', 'feature']
    has_interp = any(term in content for term in interp_terms)

    # Must have ML/neural network terms
    ml_terms = ['neural', 'transformer', 'language model', 'llm', 'gpt', 'bert',
                'attention', 'deep learning', 'large language']
    has_ml = any(term in content for term in ml_terms)

    return has_interp and has_ml


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
    # Create sets for deduplication
    existing_ids = {p.get('id', '') for p in existing}
    existing_urls = {p.get('url', '') for p in existing}
    existing_titles = {p.get('title', '').lower().strip()[:100] for p in existing}

    merged = list(existing)
    added_count = 0

    for paper in new:
        paper_id = paper.get('id', '')
        paper_url = paper.get('url', '')
        paper_title = paper.get('title', '').lower().strip()[:100]

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


def main():
    print("=" * 60)
    print("Fetching mechanistic interpretability papers...")
    print(f"Looking back {DAYS_LOOKBACK} days")
    print("=" * 60)

    all_new_papers = []

    # Fetch from arXiv
    print(f"\n[arXiv] Running {len(ARXIV_QUERIES)} queries...")
    for i, query in enumerate(ARXIV_QUERIES):
        print(f"  [{i+1}/{len(ARXIV_QUERIES)}] {query[:50]}...")
        papers = fetch_arxiv_papers(query, max_results=MAX_RESULTS_PER_QUERY)
        relevant = [p for p in papers if is_relevant_paper(p)]
        all_new_papers.extend(relevant)
        print(f"    Found {len(relevant)} relevant papers")
        time.sleep(3)  # Rate limiting

    # Fetch from Semantic Scholar
    print(f"\n[Semantic Scholar] Running {len(SEMANTIC_SCHOLAR_QUERIES)} queries...")
    for query in SEMANTIC_SCHOLAR_QUERIES:
        print(f"  Querying: {query}...")
        papers = fetch_semantic_scholar(query, limit=20)
        relevant = [p for p in papers if is_relevant_paper(p)]
        all_new_papers.extend(relevant)
        print(f"    Found {len(relevant)} relevant papers")
        time.sleep(1)

    print(f"\nTotal potentially relevant papers found: {len(all_new_papers)}")

    # Load existing and merge
    existing_data = load_existing_papers()
    existing_papers = existing_data.get('papers', [])
    print(f"Existing papers in database: {len(existing_papers)}")

    merged_papers = merge_papers(existing_papers, all_new_papers)

    # Update data
    existing_data['papers'] = merged_papers
    existing_data['lastUpdated'] = datetime.now().strftime('%Y-%m-%d')

    # Save
    save_papers(existing_data)
    print(f"\nSaved {len(merged_papers)} total papers")
    print("=" * 60)


if __name__ == '__main__':
    main()
