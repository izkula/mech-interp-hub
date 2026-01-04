#!/usr/bin/env python3
"""
Generate RSS feed from papers.json
"""

import json
import os
from datetime import datetime
import html

PAPERS_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'papers.json')
RSS_FILE = os.path.join(os.path.dirname(__file__), '..', 'feed.xml')
SITE_URL = 'https://izkula.github.io/cc'

def escape_xml(text: str) -> str:
    """Escape special XML characters."""
    return html.escape(str(text))

def generate_rss():
    """Generate RSS feed from papers data."""
    # Load papers
    with open(PAPERS_FILE, 'r') as f:
        data = json.load(f)

    papers = data.get('papers', [])[:30]  # Latest 30 papers
    last_updated = data.get('lastUpdated', datetime.now().strftime('%Y-%m-%d'))

    # Format date for RSS
    try:
        pub_date = datetime.strptime(last_updated, '%Y-%m-%d')
        rss_date = pub_date.strftime('%a, %d %b %Y 00:00:00 +0000')
    except:
        rss_date = datetime.now().strftime('%a, %d %b %Y 00:00:00 +0000')

    # Generate RSS XML
    rss = f'''<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Mechanistic Interpretability Hub</title>
    <link>{SITE_URL}</link>
    <description>Latest research in mechanistic interpretability - understanding how neural networks work internally</description>
    <language>en-us</language>
    <lastBuildDate>{rss_date}</lastBuildDate>
    <atom:link href="{SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
'''

    for paper in papers:
        title = escape_xml(paper.get('title', 'Untitled'))
        url = escape_xml(paper.get('url', ''))
        authors = escape_xml(paper.get('authors', 'Unknown'))
        abstract = escape_xml(paper.get('abstract', ''))
        date = paper.get('date', '')
        tags = paper.get('tags', [])

        # Format date for RSS
        try:
            paper_date = datetime.strptime(date, '%Y-%m-%d')
            paper_rss_date = paper_date.strftime('%a, %d %b %Y 00:00:00 +0000')
        except:
            paper_rss_date = rss_date

        # Create description with authors and abstract
        description = f"<p><strong>Authors:</strong> {authors}</p>"
        if abstract:
            description += f"<p>{abstract}</p>"
        if tags:
            description += f"<p><strong>Tags:</strong> {', '.join(tags)}</p>"

        rss += f'''
    <item>
      <title>{title}</title>
      <link>{url}</link>
      <description><![CDATA[{description}]]></description>
      <pubDate>{paper_rss_date}</pubDate>
      <guid>{url}</guid>
    </item>'''

    rss += '''
  </channel>
</rss>
'''

    # Write RSS file
    with open(RSS_FILE, 'w') as f:
        f.write(rss)

    print(f"Generated RSS feed with {len(papers)} papers")

if __name__ == '__main__':
    generate_rss()
