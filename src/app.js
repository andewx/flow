const express = require('express');
const path = require('path');
const { Ollama } = require('ollama');
const { FlowDatabase } = require('./storage/database');
const { registerBasicRoutes } = require('./routes/basic.routes');

function createOllamaClient() {
  const host = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
  return new Ollama({ host });
}

function createApp() {
  const app = express();
  const database = new FlowDatabase();
  const ollama = createOllamaClient();
  const model = process.env.OLLAMA_MODEL || 'gemma4:latest';
  const publicDir = path.join(__dirname, '..', 'public');
  const katexDir = path.join(__dirname, '..', 'node_modules', 'katex', 'dist');

  app.use(express.json({ limit: '1mb' }));
  registerBasicRoutes(app);

  app.get('/', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.get('/portal', (_req, res) => {
    res.sendFile(path.join(publicDir, 'portal.html'));
  });

  app.use(express.static(publicDir));
  app.use('/vendor/katex', express.static(katexDir));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'flow' });
  });

  app.get('/api/projects', (_req, res) => {
    res.json({ projects: database.listProjects() });
  });

  app.post('/api/projects', (req, res) => {
    try {
      const project = database.createProject(req.body || {});
      res.status(201).json({ project });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get('/api/projects/:projectId', (req, res) => {
    const project = database.getProjectBundle(req.params.projectId);

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json({ project });
  });

  app.post('/api/projects/:projectId/agents', (req, res) => {
    try {
      const agent = database.createAgent(req.params.projectId, req.body || {});
      res.status(201).json({ agent });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/projects/:projectId/goals', (req, res) => {
    try {
      const goal = database.createGoal(req.params.projectId, req.body || {});
      res.status(201).json({ goal });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/projects/:projectId/goal-checks', (req, res) => {
    try {
      const goalCheck = database.createGoalCheck(req.params.projectId, req.body || {});
      res.status(201).json({ goalCheck });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/projects/:projectId/chat', async (req, res) => {
    const { content } = req.body || {};

    if (!content || !content.trim()) {
      res.status(400).json({ error: 'Message content is required' });
      return;
    }

    const project = database.getProjectBundle(req.params.projectId);

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const conversation = project.conversation;
    const userMessage = database.addMessage(conversation.id, 'user', content.trim());
    const history = database.listMessages(conversation.id).slice(-20).map((message) => ({
      role: message.role,
      content: message.content_markdown,
    }));

    try {
      const response = await ollama.chat({
        model,
        messages: [
          { role: 'system', content: buildSystemPrompt(project) },
          ...history,
        ],
      });

      const assistantContent = response?.message?.content?.trim() || 'No response returned by Ollama.';
      const assistantMessage = database.addMessage(conversation.id, 'assistant', assistantContent);

      res.json({
        conversationId: conversation.id,
        messages: [userMessage, assistantMessage],
      });
    } catch (error) {
      res.status(503).json({
        error: 'Ollama request failed',
        detail: error.message,
      });
    }
  });

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: 'Unexpected server error' });
  });

  return app;
}

function buildSystemPrompt(project) {
  const agentLines = project.agents.length
    ? project.agents.map((agent) => `- ${agent.name} (${agent.role})`).join('\n')
    : '- None yet';
  const goalLines = project.goals.length
    ? project.goals.map((goal) => `- ${goal.title}`).join('\n')
    : '- None yet';
  const checkLines = project.goalChecks.length
    ? project.goalChecks.map((check) => `- ${check.name} [${check.check_type}]`).join('\n')
    : '- None yet';

  return [
    'You are the project orchestration assistant for Flow.',
    'Respond in clear markdown and use LaTeX delimiters for formulas when helpful.',
    'Keep the output actionable for an operator coordinating nested LLM agents.',
    '',
    `Project: ${project.project.name}`,
    `End goal: ${project.project.end_goal || 'Not defined yet'}`,
    '',
    'Agents:',
    agentLines,
    '',
    'Goals:',
    goalLines,
    '',
    'Goal checks:',
    checkLines,
  ].join('\n');
}

module.exports = { createApp };