# Mechanistic Interpretability Hub

A continuously updated summary of the most important mechanistic interpretability findings, open questions, and latest research.

**Live Site:** https://izkula.github.io/mech-interp-hub

## Features

- **Key Findings**: Major discoveries in mechanistic interpretability, organized by category (features, circuits, superposition, safety)
- **Open Questions**: Critical unsolved problems the field is working on
- **Core Techniques**: Overview of main methodological approaches (SAEs, activation patching, circuit analysis, etc.)
- **Latest Papers**: Auto-updated database of recent arXiv papers on mechanistic interpretability
- **Resources**: Essential reading, research groups, tools, and communities

## Automatic Updates

The site automatically fetches new papers daily via GitHub Actions:
- Queries arXiv for mechanistic interpretability papers
- Filters for relevant content
- Updates the papers database
- Generates RSS feed for subscribers

## Technology

- Static HTML/CSS/JavaScript (no build step required)
- Data stored in JSON files for easy updates
- GitHub Pages for hosting
- GitHub Actions for automation

## Local Development

Simply open `index.html` in a browser, or serve locally:

```bash
python -m http.server 8000
```

Then visit http://localhost:8000

## Contributing

### Adding a Paper

Edit `data/papers.json` and add an entry:

```json
{
  "id": "unique-id",
  "title": "Paper Title",
  "authors": "Author 1, Author 2",
  "date": "2025-01-01",
  "url": "https://arxiv.org/abs/...",
  "abstract": "Brief abstract...",
  "tags": ["SAE", "circuits"],
  "source": "arXiv"
}
```

### Adding a Finding

Edit `data/findings.json` and add to the `findings` array:

```json
{
  "id": "unique-id",
  "title": "Finding Title",
  "category": "features|circuits|superposition|safety",
  "description": "Description of the finding...",
  "source": "Anthropic",
  "sourceUrl": "https://...",
  "year": 2025,
  "importance": "high|medium"
}
```

## Data Sources

- [Transformer Circuits](https://transformer-circuits.pub/) - Anthropic's interpretability research
- [arXiv](https://arxiv.org/) - Preprint papers
- [Semantic Scholar](https://www.semanticscholar.org/) - Academic search

## License

MIT License

## Acknowledgments

This site aggregates research from many groups including:
- Anthropic Interpretability Team
- EleutherAI
- Redwood Research
- Apollo Research
- And many independent researchers

All credit for research findings goes to the original authors.
