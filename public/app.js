const state = {
  projects: [],
  activeProjectId: null,
  activeProject: null,
};

const elements = {};

document.addEventListener('DOMContentLoaded', () => {
  bindElements();
  bindEvents();
  loadProjects();
});

function bindElements() {
  elements.projectList = document.getElementById('project-list');
  elements.refreshProjects = document.getElementById('refresh-projects');
  elements.projectForm = document.getElementById('project-form');
  elements.projectDetail = document.getElementById('project-detail');
  elements.chatMessages = document.getElementById('chat-messages');
  elements.chatForm = document.getElementById('chat-form');
  elements.chatInput = document.getElementById('chat-input');
  elements.chatTitle = document.getElementById('chat-title');
  elements.chatModel = document.getElementById('chat-model');
}

function bindEvents() {
  elements.refreshProjects.addEventListener('click', loadProjects);
  elements.projectForm.addEventListener('submit', handleProjectCreate);
  elements.chatForm.addEventListener('submit', handleChatSubmit);
}

async function loadProjects() {
  const response = await api('/api/projects');
  state.projects = response.projects || [];

  renderProjectList();

  if (!state.activeProjectId && state.projects.length > 0) {
    await selectProject(state.projects[0].id);
  } else if (state.activeProjectId) {
    const matchingProject = state.projects.find((project) => project.id === state.activeProjectId);
    if (matchingProject) {
      await selectProject(matchingProject.id, { quiet: true });
    }
  } else {
    renderEmptyState();
  }
}

function renderProjectList() {
  if (state.projects.length === 0) {
    elements.projectList.innerHTML = '<div class="empty-state">No projects yet.</div>';
    return;
  }

  elements.projectList.innerHTML = state.projects
    .map((project) => {
      const active = project.id === state.activeProjectId ? 'active' : '';
      return `
        <button type="button" class="project-card ${active}" data-project-id="${escapeHtml(project.id)}">
          <h3>${escapeHtml(project.name)}</h3>
          <p class="card-copy">${escapeHtml(project.description || 'No description yet.')}</p>
        </button>
      `;
    })
    .join('');

  elements.projectList.querySelectorAll('[data-project-id]').forEach((button) => {
    button.addEventListener('click', () => selectProject(button.dataset.projectId));
  });
}

async function selectProject(projectId, options = {}) {
  const response = await api(`/api/projects/${projectId}`);
  state.activeProjectId = projectId;
  state.activeProject = response.project;

  renderProjectList();
  renderProjectDetail(state.activeProject);
  renderChat(state.activeProject);

  if (!options.quiet) {
    elements.chatInput.focus();
  }
}

function renderEmptyState() {
  elements.projectDetail.classList.add('empty-state');
  elements.projectDetail.textContent = 'Select a project to inspect its orchestration graph.';
  elements.chatMessages.classList.add('empty-state');
  elements.chatMessages.textContent = 'Pick a project and start the conversation.';
  elements.chatTitle.textContent = 'Main orchestration thread';
}

function renderProjectDetail(project) {
  elements.projectDetail.classList.remove('empty-state');

  const agentCount = project.agents.length;
  const goalCount = project.goals.length;
  const checkCount = project.goalChecks.length;

  elements.projectDetail.innerHTML = `
    <div class="project-summary">
      <div class="summary-card">
        <p class="eyebrow">Project</p>
        <h2>${escapeHtml(project.project.name)}</h2>
        <p>${escapeHtml(project.project.description || 'No description yet.')}</p>
        <p class="hint"><strong>End goal:</strong> ${escapeHtml(project.project.end_goal || 'Not defined yet')}</p>
      </div>
      <div class="summary-card">
        <p class="eyebrow">Signals</p>
        <div class="pill-row">
          <span class="pill">${agentCount} agents</span>
          <span class="pill">${goalCount} goals</span>
          <span class="pill">${checkCount} checks</span>
        </div>
      </div>
    </div>

    <div class="section-card">
      <div class="graph-title">
        <h4>Orchestration graph</h4>
        <small>Agents on the left, goals on the right</small>
      </div>
      <div class="graph-box">
        ${renderGraph(project)}
      </div>
    </div>

    <div class="mini-grid">
      <div class="section-card">
        <h4>Agents</h4>
        ${renderAgentList(project.agents)}
      </div>
      <div class="section-card">
        <h4>Goals</h4>
        ${renderGoalList(project.goals, project.goalChecks)}
      </div>
    </div>
  `;
}

function renderAgentList(agents) {
  if (!agents.length) {
    return '<p class="hint">No agents yet.</p>';
  }

  return agents
    .map((agent) => {
      const responsibilities = agent.responsibilities.length
        ? `<ul>${agent.responsibilities.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
        : '<p class="hint">No responsibilities defined.</p>';

      return `
        <article class="summary-card">
          <h3>${escapeHtml(agent.name)}</h3>
          <p class="hint">${escapeHtml(agent.role)}</p>
          ${responsibilities}
        </article>
      `;
    })
    .join('');
}

function renderGoalList(goals, checks) {
  if (!goals.length) {
    return '<p class="hint">No goals yet.</p>';
  }

  const checksByGoal = new Map();
  checks.forEach((check) => {
    const current = checksByGoal.get(check.goal_id) || [];
    current.push(check);
    checksByGoal.set(check.goal_id, current);
  });

  return goals
    .map((goal) => {
      const goalChecks = checksByGoal.get(goal.id) || [];
      const checkMarkup = goalChecks.length
        ? `<ul>${goalChecks
            .map((check) => `<li><strong>${escapeHtml(check.name)}</strong> <span class="hint">${escapeHtml(check.check_type)}</span></li>`)
            .join('')}</ul>`
        : '<p class="hint">No checks defined.</p>';

      return `
        <article class="summary-card">
          <h3>${escapeHtml(goal.title)}</h3>
          <p>${escapeHtml(goal.description || 'No description yet.')}</p>
          <p class="hint"><strong>Success:</strong> ${escapeHtml(goal.success_criteria || 'Not defined yet')}</p>
          ${checkMarkup}
        </article>
      `;
    })
    .join('');
}

function renderGraph(project) {
  const width = 1180;
  const height = 540;
  const rootX = width / 2;
  const rootY = 60;
  const agentBranch = layoutBranch(project.agents, 'parent_agent_id', 80, rootX - 70, 140, 122);
  const goalBranch = layoutBranch(project.goals, 'parent_goal_id', rootX + 70, width - 80, 140, 122);
  const nodes = [];
  const lines = [];

  nodes.push(drawNode(rootX, rootY, 'project', project.project.name, project.project.end_goal || 'Orchestration root'));

  agentBranch.roots.forEach((root) => {
    lines.push(drawLine(rootX, rootY + 42, agentBranch.positions.get(root.id).x, agentBranch.positions.get(root.id).y - 24));
  });

  goalBranch.roots.forEach((root) => {
    lines.push(drawLine(rootX, rootY + 42, goalBranch.positions.get(root.id).x, goalBranch.positions.get(root.id).y - 24));
  });

  agentBranch.edges.forEach((edge) => {
    const parent = agentBranch.positions.get(edge.from);
    const child = agentBranch.positions.get(edge.to);
    lines.push(drawLine(parent.x, parent.y + 28, child.x, child.y - 24));
  });

  goalBranch.edges.forEach((edge) => {
    const parent = goalBranch.positions.get(edge.from);
    const child = goalBranch.positions.get(edge.to);
    lines.push(drawLine(parent.x, parent.y + 28, child.x, child.y - 24));
  });

  for (const [id, position] of agentBranch.positions.entries()) {
    const agent = project.agents.find((item) => item.id === id);
    nodes.push(drawNode(position.x, position.y, 'agent', agent.name, agent.role));
  }

  for (const [id, position] of goalBranch.positions.entries()) {
    const goal = project.goals.find((item) => item.id === id);
    nodes.push(drawNode(position.x, position.y, 'goal', goal.title, goal.success_criteria || ''));
  }

  if (!project.agents.length) {
    nodes.push(`<text x="230" y="240" class="node-subtitle">No agents yet</text>`);
  }

  if (!project.goals.length) {
    nodes.push(`<text x="820" y="240" class="node-subtitle">No goals yet</text>`);
  }

  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Project orchestration graph">
      ${lines.join('')}
      ${nodes.join('')}
    </svg>
  `;
}

function layoutBranch(items, parentKey, xMin, xMax, yStart, yGap) {
  const childrenByParent = new Map();
  items.forEach((item) => {
    const parentId = item[parentKey] || '__root__';
    const siblings = childrenByParent.get(parentId) || [];
    siblings.push(item);
    childrenByParent.set(parentId, siblings);
  });

  const roots = childrenByParent.get('__root__') || [];
  const positions = new Map();
  const edges = [];
  const totalLeaves = roots.reduce((sum, root) => sum + countLeaves(root, childrenByParent), 0);
  const leafSpacing = totalLeaves > 0 ? (xMax - xMin) / (totalLeaves + 1) : xMax - xMin;
  let leafCursor = xMin + leafSpacing;

  function place(item, depth) {
    const children = childrenByParent.get(item.id) || [];
    const y = yStart + depth * yGap;

    if (children.length === 0) {
      const x = leafCursor;
      leafCursor += leafSpacing;
      positions.set(item.id, { x, y });
      return x;
    }

    const childXs = children.map((child) => place(child, depth + 1));
    const x = childXs.reduce((sum, value) => sum + value, 0) / childXs.length;
    positions.set(item.id, { x, y });
    children.forEach((child) => edges.push({ from: item.id, to: child.id }));
    return x;
  }

  roots.forEach((root) => place(root, 0));

  return { roots, positions, edges };
}

function countLeaves(item, childrenByParent) {
  const children = childrenByParent.get(item.id) || [];
  if (children.length === 0) {
    return 1;
  }

  return children.reduce((sum, child) => sum + countLeaves(child, childrenByParent), 0);
}

function drawNode(x, y, kind, label, subtitle) {
  const fill = kind === 'project' ? '#0f766e' : kind === 'goal' ? '#b45309' : '#115e59';
  return `
    <g transform="translate(${x}, ${y})">
      <rect x="-92" y="-24" width="184" height="48" rx="16" fill="rgba(255,255,255,0.92)" stroke="rgba(19,50,47,0.12)" />
      <rect x="-92" y="-24" width="184" height="6" rx="16" fill="${fill}" />
      <text class="node-chip" x="0" y="-4" text-anchor="middle">${escapeHtml(kind)}</text>
      <text class="node-label" x="0" y="15" text-anchor="middle">${escapeHtml(label)}</text>
      ${subtitle ? `<text class="node-subtitle" x="0" y="29" text-anchor="middle">${escapeHtml(subtitle)}</text>` : ''}
    </g>
  `;
}

function drawLine(x1, y1, x2, y2) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(15, 118, 110, 0.35)" stroke-width="2" />`;
}

function renderChat(project) {
  elements.chatMessages.classList.remove('empty-state');
  elements.chatTitle.textContent = project.conversation.title;
  elements.chatModel.textContent = `ollama / ${project.project.id.slice(0, 8)}`;

  if (!project.messages.length) {
    elements.chatMessages.innerHTML = '<div class="empty-state">No messages yet. Ask for a plan or a goal check.</div>';
    return;
  }

  elements.chatMessages.innerHTML = project.messages
    .map(
      (message) => `
        <article class="message ${message.role}">
          <div class="message-header">
            <span>${escapeHtml(message.role)}</span>
            <span>${new Date(message.created_at).toLocaleString()}</span>
          </div>
          <div class="markdown-body">${message.rendered_html}</div>
        </article>
      `,
    )
    .join('');
}

async function handleProjectCreate(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const payload = Object.fromEntries(formData.entries());

  const response = await api('/api/projects', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  event.currentTarget.reset();
  await loadProjects();
  await selectProject(response.project.id);
}

async function handleChatSubmit(event) {
  event.preventDefault();

  if (!state.activeProjectId) {
    return;
  }

  const content = elements.chatInput.value.trim();
  if (!content) {
    return;
  }

  elements.chatInput.value = '';

  const response = await api(`/api/projects/${state.activeProjectId}/chat`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });

  const project = state.activeProject;
  project.messages.push(...response.messages);
  renderChat(project);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error || 'Request failed');
  }

  return body;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}