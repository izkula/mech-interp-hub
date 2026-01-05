// Mechanistic Interpretability Hub - Main JavaScript

class MechInterpHub {
    constructor() {
        this.findings = [];
        this.questions = [];
        this.techniques = [];
        this.papers = [];
        this.resources = {};
        this.neuroComparisons = [];
        this.currentFilter = 'all';

        this.init();
    }

    async init() {
        try {
            await this.loadData();
            this.renderFindings();
            this.renderQuestions();
            this.renderTechniques();
            this.renderPapers();
            this.renderNeuroComparisons();
            this.renderResources();
            this.setupEventListeners();
            this.updateLastUpdated();
        } catch (error) {
            console.error('Error initializing:', error);
        }
    }

    async loadData() {
        const [findingsRes, papersRes, resourcesRes] = await Promise.all([
            fetch('data/findings.json'),
            fetch('data/papers.json'),
            fetch('data/resources.json')
        ]);

        const findingsData = await findingsRes.json();
        const papersData = await papersRes.json();
        const resourcesData = await resourcesRes.json();

        this.findings = findingsData.findings || [];
        this.questions = findingsData.openQuestions || [];
        this.techniques = findingsData.techniques || [];
        this.neuroComparisons = findingsData.neuroscienceComparisons || [];
        this.papers = papersData.papers || [];
        this.resources = resourcesData;
        this.lastUpdated = papersData.lastUpdated || findingsData.lastUpdated;
    }

    updateLastUpdated() {
        const el = document.getElementById('last-updated');
        if (el && this.lastUpdated) {
            const date = new Date(this.lastUpdated);
            el.textContent = `Last updated: ${date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            })}`;
        }
    }

    renderFindings() {
        const container = document.getElementById('findings-grid');
        if (!container) return;

        const filteredFindings = this.currentFilter === 'all'
            ? this.findings
            : this.findings.filter(f => f.category === this.currentFilter);

        container.innerHTML = filteredFindings.map(finding => `
            <div class="finding-card" data-category="${finding.category}">
                <span class="category ${finding.category}">${finding.category}</span>
                <h3>${finding.title}</h3>
                <p>${finding.description}</p>
                <div class="meta">
                    <span class="source">
                        <a href="${finding.sourceUrl}" target="_blank">${finding.source}</a>
                    </span>
                    <span class="year">${finding.year}</span>
                </div>
            </div>
        `).join('');
    }

    renderQuestions() {
        const container = document.getElementById('questions-list');
        if (!container) return;

        container.innerHTML = this.questions.map(question => `
            <div class="question-card ${question.importance === 'critical' ? 'critical' : ''}">
                <h3>${question.question}</h3>
                <p>${question.description}</p>
                <span class="importance">${question.importance === 'critical' ? 'Critical' : 'Important'} open problem</span>
            </div>
        `).join('');
    }

    renderTechniques() {
        const container = document.getElementById('techniques-grid');
        if (!container) return;

        container.innerHTML = this.techniques.map(technique => `
            <div class="technique-card">
                <h3>${technique.name}</h3>
                <p>${technique.description}</p>
                <div class="papers-count">${technique.keyPapers?.length || 0} key papers</div>
            </div>
        `).join('');
    }

    renderPapers(searchTerm = '') {
        const container = document.getElementById('papers-list');
        if (!container) return;

        let filteredPapers = this.papers;

        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filteredPapers = this.papers.filter(p =>
                p.title.toLowerCase().includes(term) ||
                p.authors.toLowerCase().includes(term) ||
                (p.abstract && p.abstract.toLowerCase().includes(term)) ||
                (p.tags && p.tags.some(t => t.toLowerCase().includes(term)))
            );
        }

        // Sort purely by date (newest first) - featured papers highlighted inline
        filteredPapers.sort((a, b) => new Date(b.date) - new Date(a.date));

        const renderPaperCard = (paper, isFeatured = false) => {
            const date = new Date(paper.date);
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const isNew = () => {
                const weekAgo = new Date();
                weekAgo.setDate(weekAgo.getDate() - 14);
                return date > weekAgo;
            };

            return `
                <div class="paper-card ${isFeatured ? 'featured' : ''}">
                    <div class="paper-date">
                        <div class="month">${months[date.getMonth()]}</div>
                        <div class="day">${date.getDate()}</div>
                        <div class="year">${date.getFullYear()}</div>
                    </div>
                    <div class="paper-content">
                        <h3>
                            <a href="${paper.url}" target="_blank">${paper.title}</a>
                            ${isFeatured ? '<span class="featured-badge">Key Paper</span>' : ''}
                            ${isNew() ? '<span class="new-badge">New</span>' : ''}
                        </h3>
                        <div class="paper-authors">${paper.authors}</div>
                        ${paper.abstract ? `<p class="paper-abstract">${paper.abstract}</p>` : ''}
                        ${paper.tags ? `
                            <div class="paper-tags">
                                ${paper.tags.map(tag => `<span class="paper-tag">${tag}</span>`).join('')}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        };

        // Separate recent papers from key/foundational papers
        const recentPapers = filteredPapers.filter(p => !p.featured);
        const keyPapers = filteredPapers.filter(p => p.featured);

        // Sort each group by date
        recentPapers.sort((a, b) => new Date(b.date) - new Date(a.date));
        keyPapers.sort((a, b) => new Date(b.date) - new Date(a.date));

        // Show recent papers first (auto-updating), then key papers below
        let html = '';

        if (recentPapers.length > 0) {
            html += `
                <div class="papers-section">
                    <h3 class="papers-section-title">Recent Papers</h3>
                    <p class="papers-section-desc">${recentPapers.length} papers from the latest research (auto-updates daily)</p>
                    ${recentPapers.map(p => renderPaperCard(p, false)).join('')}
                </div>
            `;
        }

        if (keyPapers.length > 0 && !searchTerm) {
            html += `
                <div class="papers-section" style="margin-top: 32px;">
                    <h3 class="papers-section-title">Key Papers</h3>
                    <p class="papers-section-desc">${keyPapers.length} foundational and high-impact papers</p>
                    ${keyPapers.map(p => renderPaperCard(p, true)).join('')}
                </div>
            `;
        }

        container.innerHTML = html || '<p>No papers found.</p>';

        // Hide load more button since we show all papers
        const loadMoreBtn = document.getElementById('load-more-papers');
        if (loadMoreBtn) {
            loadMoreBtn.style.display = 'none';
        }
    }

    renderNeuroComparisons() {
        const container = document.getElementById('neuro-comparisons-grid');
        if (!container) return;

        container.innerHTML = this.neuroComparisons.map(comparison => `
            <div class="neuro-comparison-card">
                <div class="comparison-header">
                    <div class="concept ai-concept">
                        <span class="concept-label">AI</span>
                        <span class="concept-name">${comparison.aiConcept}</span>
                    </div>
                    <div class="comparison-arrow">↔</div>
                    <div class="concept neuro-concept">
                        <span class="concept-label">Neuroscience</span>
                        <span class="concept-name">${comparison.neuroConcept}</span>
                    </div>
                </div>
                <p class="comparison-text">${comparison.comparison}</p>
                <div class="comparison-implication">
                    <strong>Implication:</strong> ${comparison.implication}
                </div>
                ${comparison.sourceUrl ? `<a href="${comparison.sourceUrl}" target="_blank" class="comparison-source">Learn more →</a>` : ''}
            </div>
        `).join('');
    }

    renderResources() {
        const sections = {
            'essential-reading': this.resources.essentialReading,
            'research-groups': this.resources.researchGroups,
            'tools-libraries': this.resources.tools,
            'communities': this.resources.communities
        };

        for (const [id, items] of Object.entries(sections)) {
            const container = document.getElementById(id);
            if (!container || !items) continue;

            container.innerHTML = items.map(item => `
                <li><a href="${item.url}" target="_blank">${item.name}</a></li>
            `).join('');
        }
    }

    setupEventListeners() {
        // Filter buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.currentFilter = e.target.dataset.filter;
                this.renderFindings();
            });
        });

        // Paper search
        const searchInput = document.getElementById('paper-search');
        if (searchInput) {
            let debounceTimer;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    this.displayedPapers = 10;
                    this.renderPapers(e.target.value);
                }, 300);
            });
        }

        // Paper sort
        const sortSelect = document.getElementById('paper-sort');
        if (sortSelect) {
            sortSelect.addEventListener('change', () => {
                const searchTerm = document.getElementById('paper-search')?.value || '';
                this.renderPapers(searchTerm);
            });
        }

        // Toggle all papers
        const loadMoreBtn = document.getElementById('load-more-papers');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', () => {
                this.showAllPapers = !this.showAllPapers;
                const searchTerm = document.getElementById('paper-search')?.value || '';
                this.renderPapers(searchTerm);
            });
        }

        // Smooth scroll for nav links
        document.querySelectorAll('.sticky-nav a').forEach(link => {
            link.addEventListener('click', (e) => {
                const href = link.getAttribute('href');
                if (href.startsWith('#')) {
                    e.preventDefault();
                    const target = document.querySelector(href);
                    if (target) {
                        target.scrollIntoView({ behavior: 'smooth' });
                    }
                }
            });
        });

        // Highlight active nav on scroll
        const sections = document.querySelectorAll('.section[id]');
        const navLinks = document.querySelectorAll('.sticky-nav a');

        window.addEventListener('scroll', () => {
            let current = '';
            sections.forEach(section => {
                const sectionTop = section.offsetTop - 100;
                if (window.scrollY >= sectionTop) {
                    current = section.getAttribute('id');
                }
            });

            navLinks.forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('href') === `#${current}`) {
                    link.classList.add('active');
                }
            });
        });
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new MechInterpHub();
});
