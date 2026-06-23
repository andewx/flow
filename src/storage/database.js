const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { renderMarkdown } = require('../render/markdown');

class FlowDatabase {
  constructor(databasePath = path.join(process.cwd(), 'data', 'flow.db')) {
    this.databasePath = databasePath;
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);

    this.db.exec('PRAGMA foreign_keys = ON;');
    this.createSchema();
    this.seedIfNeeded();
  }

  createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        end_goal TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        parent_agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        responsibilities_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        parent_goal_id TEXT REFERENCES goals(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        success_criteria TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS goal_checks (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        check_type TEXT NOT NULL DEFAULT 'manual',
        parameters_json TEXT NOT NULL DEFAULT '{}',
        expected_value TEXT NOT NULL DEFAULT '',
        last_result_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        system_prompt TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
        content_markdown TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  seedIfNeeded() {
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM projects').get().count;

    if (count > 0) {
      return;
    }

    const project = this.createProject({
      name: 'Orchestration Control Room',
      description: 'A starter workspace for coordinating nested LLM agents and checking their goals.',
      endGoal: 'Ship a reliable task-planning and browser-visualization workflow for agent teams.',
    });

    const planner = this.createAgent(project.id, {
      name: 'Planner',
      role: 'Break the end goal into executable work streams.',
      responsibilities: ['Draft task plans', 'Sequence dependencies', 'Escalate blockers'],
    });

    this.createAgent(project.id, {
      name: 'Researcher',
      role: 'Collect context and validate assumptions.',
      parentAgentId: planner.id,
      responsibilities: ['Inspect code paths', 'Summarize findings', 'Flag missing evidence'],
    });

    this.createAgent(project.id, {
      name: 'Executor',
      role: 'Turn validated plans into implementation steps.',
      parentAgentId: planner.id,
      responsibilities: ['Apply edits', 'Run checks', 'Report outcomes'],
    });

    const goal = this.createGoal(project.id, {
      title: 'Ship the first usable orchestration flow',
      description: 'Expose project state, agent hierarchy, and markdown chat in one browser view.',
      successCriteria: 'A user can create a project, inspect the agent tree, and send Ollama prompts.',
    });

    this.createGoalCheck(project.id, {
      goalId: goal.id,
      name: 'UI loads project detail',
      checkType: 'manual',
      parameters: { view: 'project-dashboard' },
      expectedValue: 'Project tree and chat panel render together',
    });

    this.createGoalCheck(project.id, {
      goalId: goal.id,
      name: 'Ollama returns markdown',
      checkType: 'manual',
      parameters: { model: process.env.OLLAMA_MODEL || 'llama3.1' },
      expectedValue: 'Assistant replies are rendered as markdown with LaTeX support',
    });

    this.createConversation(project.id, 'Main orchestration thread');
  }

  now() {
    return new Date().toISOString();
  }

  json(value) {
    return JSON.stringify(value ?? {});
  }

  parseJson(value, fallback = {}) {
    if (!value) {
      return fallback;
    }

    try {
      return JSON.parse(value);
    } catch (_error) {
      return fallback;
    }
  }

  touchProject(projectId) {
    this.db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(this.now(), projectId);
  }

  createProject({ name, description = '', endGoal = '' }) {
    if (!name || !name.trim()) {
      throw new Error('Project name is required');
    }

    const id = randomUUID();
    const timestamp = this.now();

    this.db.prepare(`
      INSERT INTO projects (id, name, description, end_goal, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name.trim(), description.trim(), endGoal.trim(), timestamp, timestamp);

    const conversation = this.createConversation(id, 'Main orchestration thread');

    return {
      id,
      name: name.trim(),
      description: description.trim(),
      end_goal: endGoal.trim(),
      status: 'active',
      created_at: timestamp,
      updated_at: timestamp,
      conversation,
    };
  }

  createConversation(projectId, title = 'Main orchestration thread') {
    const existing = this.db.prepare('SELECT * FROM conversations WHERE project_id = ? ORDER BY created_at LIMIT 1').get(projectId);

    if (existing) {
      return existing;
    }

    const id = randomUUID();
    const timestamp = this.now();

    this.db.prepare(`
      INSERT INTO conversations (id, project_id, title, system_prompt, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, projectId, title, '', timestamp, timestamp);

    return this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  }

  listProjects() {
    return this.db.prepare(`
      SELECT
        id,
        name,
        description,
        end_goal,
        status,
        created_at,
        updated_at
      FROM projects
      ORDER BY updated_at DESC, created_at DESC
    `).all();
  }

  getProject(projectId) {
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) || null;
  }

  listAgents(projectId) {
    return this.db.prepare('SELECT * FROM agents WHERE project_id = ? ORDER BY order_index ASC, created_at ASC').all(projectId).map((agent) => ({
      ...agent,
      responsibilities: this.parseJson(agent.responsibilities_json, []),
    }));
  }

  listGoals(projectId) {
    return this.db.prepare('SELECT * FROM goals WHERE project_id = ? ORDER BY order_index ASC, created_at ASC').all(projectId);
  }

  listGoalChecks(projectId) {
    return this.db.prepare(`
      SELECT goal_checks.*
      FROM goal_checks
      JOIN goals ON goals.id = goal_checks.goal_id
      WHERE goals.project_id = ?
      ORDER BY goal_checks.order_index ASC, goal_checks.created_at ASC
    `).all(projectId).map((check) => ({
      ...check,
      parameters: this.parseJson(check.parameters_json, {}),
      last_result: this.parseJson(check.last_result_json, {}),
    }));
  }

  getConversation(projectId) {
    return this.createConversation(projectId);
  }

  listMessages(conversationId) {
    return this.db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').all(conversationId).map((message) => ({
      ...message,
      rendered_html: renderMarkdown(message.content_markdown),
    }));
  }

  addMessage(conversationId, role, contentMarkdown) {
    const id = randomUUID();
    const timestamp = this.now();

    this.db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content_markdown, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, conversationId, role, contentMarkdown, timestamp);

    const conversation = this.db.prepare('SELECT project_id FROM conversations WHERE id = ?').get(conversationId);
    if (conversation) {
      this.touchProject(conversation.project_id);
    }

    return {
      id,
      conversation_id: conversationId,
      role,
      content_markdown: contentMarkdown,
      created_at: timestamp,
      rendered_html: renderMarkdown(contentMarkdown),
    };
  }

  createAgent(projectId, { name, role, responsibilities = [], parentAgentId = null }) {
    const project = this.getProject(projectId);

    if (!project) {
      throw new Error('Project not found');
    }

    if (!name || !name.trim()) {
      throw new Error('Agent name is required');
    }

    if (!role || !role.trim()) {
      throw new Error('Agent role is required');
    }

    if (parentAgentId) {
      const parent = this.db.prepare('SELECT id FROM agents WHERE id = ? AND project_id = ?').get(parentAgentId, projectId);
      if (!parent) {
        throw new Error('Parent agent not found in this project');
      }
    }

    const id = randomUUID();
    const timestamp = this.now();

    this.db.prepare(`
      INSERT INTO agents (id, project_id, parent_agent_id, name, role, responsibilities_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, parentAgentId, name.trim(), role.trim(), this.json(responsibilities), timestamp, timestamp);

    this.touchProject(projectId);

    return this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
  }

  createGoal(projectId, { title, description = '', successCriteria = '', parentGoalId = null }) {
    const project = this.getProject(projectId);

    if (!project) {
      throw new Error('Project not found');
    }

    if (!title || !title.trim()) {
      throw new Error('Goal title is required');
    }

    if (parentGoalId) {
      const parent = this.db.prepare('SELECT id FROM goals WHERE id = ? AND project_id = ?').get(parentGoalId, projectId);
      if (!parent) {
        throw new Error('Parent goal not found in this project');
      }
    }

    const id = randomUUID();
    const timestamp = this.now();

    this.db.prepare(`
      INSERT INTO goals (id, project_id, parent_goal_id, title, description, success_criteria, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, parentGoalId, title.trim(), description.trim(), successCriteria.trim(), timestamp, timestamp);

    this.touchProject(projectId);

    return this.db.prepare('SELECT * FROM goals WHERE id = ?').get(id);
  }

  createGoalCheck(projectId, { goalId, name, checkType = 'manual', parameters = {}, expectedValue = '' }) {
    const goal = this.db.prepare('SELECT id FROM goals WHERE id = ? AND project_id = ?').get(goalId, projectId);

    if (!goal) {
      throw new Error('Goal not found in this project');
    }

    if (!name || !name.trim()) {
      throw new Error('Goal check name is required');
    }

    const id = randomUUID();
    const timestamp = this.now();

    this.db.prepare(`
      INSERT INTO goal_checks (id, goal_id, name, check_type, parameters_json, expected_value, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, goalId, name.trim(), checkType.trim(), this.json(parameters), expectedValue.trim(), timestamp, timestamp);

    this.touchProject(projectId);

    return this.db.prepare('SELECT * FROM goal_checks WHERE id = ?').get(id);
  }

  getProjectBundle(projectId) {
    const project = this.getProject(projectId);

    if (!project) {
      return null;
    }

    const conversation = this.getConversation(projectId);

    return {
      project,
      agents: this.listAgents(projectId),
      goals: this.listGoals(projectId),
      goalChecks: this.listGoalChecks(projectId),
      conversation,
      messages: this.listMessages(conversation.id),
    };
  }
}

module.exports = { FlowDatabase };