const markdownIt = require('markdown-it');
const texmath = require('markdown-it-texmath');
const katex = require('katex');

const renderer = markdownIt({
  html: false,
  breaks: true,
  linkify: true,
});

renderer.use(texmath, {
  engine: katex,
  delimiters: 'dollars',
  katexOptions: {
    throwOnError: false,
    displayMode: false,
  },
});

function renderMarkdown(content) {
  return renderer.render(content || '');
}

module.exports = { renderMarkdown };