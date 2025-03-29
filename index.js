#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { z } from "zod";
import { readFileSync, existsSync } from "fs";
// Define memory file path using environment variable with fallback
const parentPath = path.dirname(fileURLToPath(import.meta.url));
const defaultMemoryPath = path.join(parentPath, 'memory.json');
const defaultSessionsPath = path.join(parentPath, 'sessions.json');
// Properly handle absolute and relative paths for MEMORY_FILE_PATH
const MEMORY_FILE_PATH = process.env.MEMORY_FILE_PATH
    ? path.isAbsolute(process.env.MEMORY_FILE_PATH)
        ? process.env.MEMORY_FILE_PATH // Use absolute path as is
        : path.join(process.cwd(), process.env.MEMORY_FILE_PATH) // Relative to current working directory
    : defaultMemoryPath; // Default fallback
// Properly handle absolute and relative paths for SESSIONS_FILE_PATH
const SESSIONS_FILE_PATH = process.env.SESSIONS_FILE_PATH
    ? path.isAbsolute(process.env.SESSIONS_FILE_PATH)
        ? process.env.SESSIONS_FILE_PATH // Use absolute path as is
        : path.join(process.cwd(), process.env.SESSIONS_FILE_PATH) // Relative to current working directory
    : defaultSessionsPath; // Default fallback
// Software Development specific entity types
const VALID_ENTITY_TYPES = [
    'project', // Overall software project
    'component', // Module, service, or package within a project
    'feature', // Specific functionality being developed
    'issue', // Bug or problem to be fixed
    'task', // Work item or activity needed for development
    'technology', // Language, framework, or tool used
    'decision', // Important technical or architectural decision
    'milestone', // Key project deadline or phase
    'environment', // Development, staging, production environments
    'documentation', // Project documentation
    'requirement', // Project requirement or specification
    'status', // Entity status (inactive, active, or complete)
    'priority' // Entity priority (low or high)
];
// Software Development specific relation types
const VALID_RELATION_TYPES = [
    'depends_on', // Dependency relationship
    'implements', // Component implements a feature
    'blocked_by', // Task is blocked by an issue
    'uses', // Component uses a technology
    'part_of', // Component is part of a project
    'contains', // Project contains a component
    'related_to', // General relationship
    'affects', // Issue affects a component
    'resolves', // Task resolves an issue
    'documented_in', // Component is documented in documentation
    'decided_in', // Decision was made in a meeting
    'required_by', // Feature is required by a requirement
    'has_status', // Entity has a particular status
    'has_priority', // Entity has a particular priority
    'depends_on_milestone', // Task depends on reaching a milestone
    'precedes', // Task precedes another task (for sequencing)
    'tested_in' // Component is tested in an environment
];
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Collect tool descriptions from text files
const toolDescriptions = {
    'startsession': '',
    'loadcontext': '',
    'deletecontext': '',
    'buildcontext': '',
    'advancedcontext': '',
    'endsession': '',
};
for (const tool of Object.keys(toolDescriptions)) {
    try {
        const descriptionFilePath = path.resolve(__dirname, `developer_${tool}.txt`);
        if (existsSync(descriptionFilePath)) {
            toolDescriptions[tool] = readFileSync(descriptionFilePath, 'utf-8');
        }
    }
    catch (error) {
        console.error(`Error reading description file for tool '${tool}': ${error}`);
    }
}
// Session management functions
async function loadSessionStates() {
    try {
        const fileContent = await fs.readFile(SESSIONS_FILE_PATH, 'utf-8');
        const sessions = JSON.parse(fileContent);
        // Convert from object to Map
        const sessionsMap = new Map();
        for (const [key, value] of Object.entries(sessions)) {
            sessionsMap.set(key, value);
        }
        return sessionsMap;
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === "ENOENT") {
            return new Map();
        }
        throw error;
    }
}
async function saveSessionStates(sessionsMap) {
    // Convert from Map to object
    const sessions = {};
    for (const [key, value] of sessionsMap.entries()) {
        sessions[key] = value;
    }
    await fs.writeFile(SESSIONS_FILE_PATH, JSON.stringify(sessions, null, 2), 'utf-8');
}
// Generate a unique session ID
function generateSessionId() {
    return `dev_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}
// Basic validation functions
function validateEntityType(entityType) {
    return VALID_ENTITY_TYPES.includes(entityType);
}
function validateRelationType(relationType) {
    return VALID_RELATION_TYPES.includes(relationType);
}
// Define the valid status and priority values
const VALID_STATUS_VALUES = ['inactive', 'active', 'complete'];
const VALID_PRIORITY_VALUES = ['low', 'high'];
// The KnowledgeGraphManager class contains all operations to interact with the knowledge graph
class KnowledgeGraphManager {
    async loadGraph() {
        try {
            const fileContent = await fs.readFile(MEMORY_FILE_PATH, 'utf-8');
            return JSON.parse(fileContent);
        }
        catch (error) {
            if (error instanceof Error && 'code' in error && error.code === "ENOENT") {
                return { entities: [], relations: [] };
            }
            throw error;
        }
    }
    async saveGraph(graph) {
        await fs.writeFile(MEMORY_FILE_PATH, JSON.stringify(graph, null, 2), 'utf-8');
    }
    // Initialize status and priority entities
    async initializeStatusAndPriority() {
        const graph = await this.loadGraph();
        // Create status entities if they don't exist
        for (const statusValue of VALID_STATUS_VALUES) {
            const statusName = `status:${statusValue}`;
            if (!graph.entities.some(e => e.name === statusName && e.entityType === 'status')) {
                graph.entities.push({
                    name: statusName,
                    entityType: 'status',
                    observations: [`A ${statusValue} status value`]
                });
            }
        }
        // Create priority entities if they don't exist
        for (const priorityValue of VALID_PRIORITY_VALUES) {
            const priorityName = `priority:${priorityValue}`;
            if (!graph.entities.some(e => e.name === priorityName && e.entityType === 'priority')) {
                graph.entities.push({
                    name: priorityName,
                    entityType: 'priority',
                    observations: [`A ${priorityValue} priority value`]
                });
            }
        }
        await this.saveGraph(graph);
    }
    // Helper method to get status of an entity
    async getEntityStatus(entityName) {
        const graph = await this.loadGraph();
        // Find status relation for this entity
        const statusRelation = graph.relations.find(r => r.from === entityName &&
            r.relationType === 'has_status');
        if (statusRelation) {
            // Extract status value from the status entity name (status:value)
            return statusRelation.to.split(':')[1];
        }
        return null;
    }
    // Helper method to get priority of an entity
    async getEntityPriority(entityName) {
        const graph = await this.loadGraph();
        // Find priority relation for this entity
        const priorityRelation = graph.relations.find(r => r.from === entityName &&
            r.relationType === 'has_priority');
        if (priorityRelation) {
            // Extract priority value from the priority entity name (priority:value)
            return priorityRelation.to.split(':')[1];
        }
        return null;
    }
    // Helper method to set status of an entity
    async setEntityStatus(entityName, statusValue) {
        if (!VALID_STATUS_VALUES.includes(statusValue)) {
            throw new Error(`Invalid status value: ${statusValue}. Valid values are: ${VALID_STATUS_VALUES.join(', ')}`);
        }
        const graph = await this.loadGraph();
        // Remove any existing status relations for this entity
        graph.relations = graph.relations.filter(r => !(r.from === entityName && r.relationType === 'has_status'));
        // Add new status relation
        graph.relations.push({
            from: entityName,
            to: `status:${statusValue}`,
            relationType: 'has_status'
        });
        await this.saveGraph(graph);
    }
    // Helper method to set priority of an entity
    async setEntityPriority(entityName, priorityValue) {
        if (!VALID_PRIORITY_VALUES.includes(priorityValue)) {
            throw new Error(`Invalid priority value: ${priorityValue}. Valid values are: ${VALID_PRIORITY_VALUES.join(', ')}`);
        }
        const graph = await this.loadGraph();
        // Remove any existing priority relations for this entity
        graph.relations = graph.relations.filter(r => !(r.from === entityName && r.relationType === 'has_priority'));
        // Add new priority relation
        graph.relations.push({
            from: entityName,
            to: `priority:${priorityValue}`,
            relationType: 'has_priority'
        });
        await this.saveGraph(graph);
    }
    async createEntities(entities) {
        // Validate entity types
        for (const entity of entities) {
            if (!validateEntityType(entity.entityType)) {
                throw new Error(`Invalid entity type: ${entity.entityType}. Valid types are: ${VALID_ENTITY_TYPES.join(', ')}`);
            }
        }
        const graph = await this.loadGraph();
        const newEntities = entities.filter(e => !graph.entities.some(existingEntity => existingEntity.name === e.name));
        graph.entities.push(...newEntities);
        await this.saveGraph(graph);
        return newEntities;
    }
    async createRelations(relations) {
        // Validate relation types
        for (const relation of relations) {
            if (!validateRelationType(relation.relationType)) {
                throw new Error(`Invalid relation type: ${relation.relationType}. Valid types are: ${VALID_RELATION_TYPES.join(', ')}`);
            }
        }
        const graph = await this.loadGraph();
        // Check if entities exist
        for (const relation of relations) {
            const fromEntity = graph.entities.find(e => e.name === relation.from);
            const toEntity = graph.entities.find(e => e.name === relation.to);
            if (!fromEntity) {
                throw new Error(`Source entity '${relation.from}' does not exist. Please create it first.`);
            }
            if (!toEntity) {
                throw new Error(`Target entity '${relation.to}' does not exist. Please create it first.`);
            }
        }
        const newRelations = relations.filter(r => !graph.relations.some(existingRelation => existingRelation.from === r.from &&
            existingRelation.to === r.to &&
            existingRelation.relationType === r.relationType));
        graph.relations.push(...newRelations);
        await this.saveGraph(graph);
        return newRelations;
    }
    async addObservations(observations) {
        const graph = await this.loadGraph();
        const results = observations.map(o => {
            const entity = graph.entities.find(e => e.name === o.entityName);
            if (!entity) {
                throw new Error(`Entity with name ${o.entityName} not found`);
            }
            const newObservations = o.contents.filter(content => !entity.observations.includes(content));
            entity.observations.push(...newObservations);
            return { entityName: o.entityName, addedObservations: newObservations };
        });
        await this.saveGraph(graph);
        return results;
    }
    async deleteEntities(entityNames) {
        const graph = await this.loadGraph();
        graph.entities = graph.entities.filter(e => !entityNames.includes(e.name));
        graph.relations = graph.relations.filter(r => !entityNames.includes(r.from) && !entityNames.includes(r.to));
        await this.saveGraph(graph);
    }
    async deleteObservations(deletions) {
        const graph = await this.loadGraph();
        deletions.forEach(d => {
            const entity = graph.entities.find(e => e.name === d.entityName);
            if (entity) {
                entity.observations = entity.observations.filter(o => !d.observations.includes(o));
            }
        });
        await this.saveGraph(graph);
    }
    async deleteRelations(relations) {
        const graph = await this.loadGraph();
        graph.relations = graph.relations.filter(r => !relations.some(delRelation => r.from === delRelation.from &&
            r.to === delRelation.to &&
            r.relationType === delRelation.relationType));
        await this.saveGraph(graph);
    }
    async readGraph() {
        return this.loadGraph();
    }
    // Basic search function
    async searchNodes(query) {
        const graph = await this.loadGraph();
        // Filter entities
        const filteredEntities = graph.entities.filter(e => e.name.toLowerCase().includes(query.toLowerCase()) ||
            e.entityType.toLowerCase().includes(query.toLowerCase()) ||
            e.observations.some(o => o.toLowerCase().includes(query.toLowerCase())));
        // Create a Set of filtered entity names for quick lookup
        const filteredEntityNames = new Set(filteredEntities.map(e => e.name));
        // Filter relations to only include those between filtered entities
        const filteredRelations = graph.relations.filter(r => filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to));
        const filteredGraph = {
            entities: filteredEntities,
            relations: filteredRelations,
        };
        return filteredGraph;
    }
    async openNodes(names) {
        const graph = await this.loadGraph();
        // Filter entities
        const filteredEntities = graph.entities.filter(e => names.includes(e.name));
        // Create a Set of filtered entity names for quick lookup
        const filteredEntityNames = new Set(filteredEntities.map(e => e.name));
        // Filter relations to only include those between filtered entities
        const filteredRelations = graph.relations.filter(r => filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to));
        const filteredGraph = {
            entities: filteredEntities,
            relations: filteredRelations,
        };
        return filteredGraph;
    }
    // Software Development specific functions
    // Get project overview including components, features, issues, etc.
    async getProjectStatus(projectName) {
        const graph = await this.loadGraph();
        // Find the project entity
        const project = graph.entities.find(e => e.name === projectName && e.entityType === 'project');
        if (!project) {
            throw new Error(`Project '${projectName}' not found`);
        }
        // Find components that are part of this project
        const components = [];
        // Find features, issues, tasks, milestones related to this project
        const features = [];
        const issues = [];
        const tasks = [];
        const milestones = [];
        // Find entities directly related to the project
        for (const relation of graph.relations) {
            if (relation.from === projectName || relation.to === projectName) {
                const relatedEntity = graph.entities.find(e => (relation.from === projectName && e.name === relation.to) ||
                    (relation.to === projectName && e.name === relation.from));
                if (relatedEntity) {
                    if (relatedEntity.entityType === 'component')
                        components.push(relatedEntity);
                    if (relatedEntity.entityType === 'feature')
                        features.push(relatedEntity);
                    if (relatedEntity.entityType === 'issue')
                        issues.push(relatedEntity);
                    if (relatedEntity.entityType === 'task')
                        tasks.push(relatedEntity);
                    if (relatedEntity.entityType === 'milestone')
                        milestones.push(relatedEntity);
                }
            }
        }
        // Find entities related to components of the project
        for (const component of components) {
            for (const relation of graph.relations) {
                if (relation.from === component.name || relation.to === component.name) {
                    const relatedEntity = graph.entities.find(e => (relation.from === component.name && e.name === relation.to) ||
                        (relation.to === component.name && e.name === relation.from));
                    if (relatedEntity) {
                        if (relatedEntity.entityType === 'feature' && !features.some(f => f.name === relatedEntity.name)) {
                            features.push(relatedEntity);
                        }
                        if (relatedEntity.entityType === 'issue' && !issues.some(i => i.name === relatedEntity.name)) {
                            issues.push(relatedEntity);
                        }
                        if (relatedEntity.entityType === 'task' && !tasks.some(t => t.name === relatedEntity.name)) {
                            tasks.push(relatedEntity);
                        }
                    }
                }
            }
        }
        // Get active tasks and issues
        const statuses = {};
        const priorities = {};
        // Load status and priority for tasks and issues
        for (const entity of [...tasks, ...issues, ...features, ...milestones]) {
            const status = await this.getEntityStatus(entity.name);
            if (status) {
                statuses[entity.name] = status;
            }
            const priority = await this.getEntityPriority(entity.name);
            if (priority) {
                priorities[entity.name] = priority;
            }
        }
        // Filter active tasks and issues based on status
        const activeTasks = tasks.filter(task => {
            const status = statuses[task.name];
            return status ? status === 'active' : true;
        });
        const activeIssues = issues.filter(issue => {
            const status = statuses[issue.name];
            return status ? status === 'active' : true;
        });
        // Find upcoming milestones
        const upcomingMilestones = milestones.filter(milestone => {
            const status = statuses[milestone.name];
            return status ? status === 'active' : true;
        });
        // Get decision history
        const decisions = graph.entities.filter(e => e.entityType === 'decision' &&
            graph.relations.some(r => (r.from === e.name && r.to === projectName) ||
                (r.to === e.name && r.from === projectName)));
        // Find task sequencing
        const taskSequencing = {};
        for (const task of tasks) {
            const precedingTasks = [];
            const followingTasks = [];
            // Find tasks that this task precedes
            for (const relation of graph.relations) {
                if (relation.from === task.name && relation.relationType === 'precedes') {
                    followingTasks.push(relation.to);
                }
                if (relation.to === task.name && relation.relationType === 'precedes') {
                    precedingTasks.push(relation.from);
                }
            }
            if (precedingTasks.length > 0 || followingTasks.length > 0) {
                taskSequencing[task.name] = {
                    precedingTasks,
                    followingTasks
                };
            }
        }
        return {
            project,
            components,
            activeFeatures: features.filter(f => {
                const status = statuses[f.name];
                return status ? status === 'active' : true;
            }),
            activeTasks,
            activeIssues,
            upcomingMilestones,
            allFeatures: features,
            allIssues: issues,
            allTasks: tasks,
            allMilestones: milestones,
            recentDecisions: decisions.slice(0, 5), // Limit to 5 most recent decisions
            statuses, // Include status mapping for reference
            priorities, // Include priority mapping for reference
            taskSequencing // Include task sequencing information
        };
    }
    // Get detailed context for a specific component
    async getComponentContext(componentName) {
        const graph = await this.loadGraph();
        // Find the component entity
        const component = graph.entities.find(e => e.name === componentName && e.entityType === 'component');
        if (!component) {
            throw new Error(`Component '${componentName}' not found`);
        }
        // Find projects this component is part of
        const projects = [];
        for (const relation of graph.relations) {
            if (relation.relationType === 'contains' && relation.to === componentName) {
                const project = graph.entities.find(e => e.name === relation.from && e.entityType === 'project');
                if (project) {
                    projects.push(project);
                }
            }
        }
        // Find features implemented by this component
        const features = [];
        for (const relation of graph.relations) {
            if (relation.relationType === 'implements' && relation.from === componentName) {
                const feature = graph.entities.find(e => e.name === relation.to && e.entityType === 'feature');
                if (feature) {
                    features.push(feature);
                }
            }
        }
        // Find technologies used by this component
        const technologies = [];
        for (const relation of graph.relations) {
            if (relation.relationType === 'uses' && relation.from === componentName) {
                const technology = graph.entities.find(e => e.name === relation.to && e.entityType === 'technology');
                if (technology) {
                    technologies.push(technology);
                }
            }
        }
        // Find issues affecting this component
        const issues = [];
        for (const relation of graph.relations) {
            if (relation.relationType === 'affects' && relation.to === componentName) {
                const issue = graph.entities.find(e => e.name === relation.from && e.entityType === 'issue');
                if (issue) {
                    issues.push(issue);
                }
            }
        }
        // Find tasks related to this component
        const tasks = [];
        for (const relation of graph.relations) {
            if ((relation.from === componentName || relation.to === componentName) &&
                graph.entities.some(e => (e.name === relation.from || e.name === relation.to) &&
                    e.name !== componentName &&
                    e.entityType === 'task')) {
                const task = graph.entities.find(e => (e.name === relation.from || e.name === relation.to) &&
                    e.name !== componentName &&
                    e.entityType === 'task');
                if (task) {
                    tasks.push(task);
                }
            }
        }
        // Find documentation for this component
        const documentation = [];
        for (const relation of graph.relations) {
            if (relation.relationType === 'documented_in' && relation.from === componentName) {
                const doc = graph.entities.find(e => e.name === relation.to && e.entityType === 'documentation');
                if (doc) {
                    documentation.push(doc);
                }
            }
        }
        // Find dependencies
        const dependencies = [];
        for (const relation of graph.relations) {
            if (relation.relationType === 'depends_on' && relation.from === componentName) {
                const dependency = graph.entities.find(e => e.name === relation.to);
                if (dependency) {
                    dependencies.push(dependency);
                }
            }
        }
        // Get statuses and priorities for tasks and issues
        const statuses = {};
        const priorities = {};
        // Load status and priority for tasks and issues
        for (const entity of [...tasks, ...issues, ...features]) {
            const status = await this.getEntityStatus(entity.name);
            if (status) {
                statuses[entity.name] = status;
            }
            const priority = await this.getEntityPriority(entity.name);
            if (priority) {
                priorities[entity.name] = priority;
            }
        }
        return {
            component,
            projects,
            features,
            technologies,
            activeIssues: issues.filter(issue => {
                const status = statuses[issue.name];
                return status ? status === 'active' : true;
            }),
            activeTasks: tasks.filter(task => {
                const status = statuses[task.name];
                return status ? status === 'active' : true;
            }),
            documentation,
            dependencies,
            allIssues: issues,
            allTasks: tasks,
            statuses,
            priorities
        };
    }
    // Get all entities related to a specific entity
    async getRelatedEntities(entityName, relationTypes) {
        const graph = await this.loadGraph();
        // Find the entity
        const entity = graph.entities.find(e => e.name === entityName);
        if (!entity) {
            throw new Error(`Entity '${entityName}' not found`);
        }
        // Find all relations involving this entity
        let relevantRelations = graph.relations.filter(r => r.from === entityName || r.to === entityName);
        // Filter by relation types if specified
        if (relationTypes && relationTypes.length > 0) {
            relevantRelations = relevantRelations.filter(r => relationTypes.includes(r.relationType));
        }
        // Get all related entities
        const related = {
            entity,
            incomingRelations: [],
            outgoingRelations: [],
        };
        for (const relation of relevantRelations) {
            if (relation.from === entityName) {
                const target = graph.entities.find(e => e.name === relation.to);
                if (target) {
                    related.outgoingRelations.push({
                        relation,
                        target
                    });
                }
            }
            else {
                const source = graph.entities.find(e => e.name === relation.from);
                if (source) {
                    related.incomingRelations.push({
                        relation,
                        source
                    });
                }
            }
        }
        return related;
    }
    // Get the history of decisions related to a project
    async getDecisionHistory(projectName) {
        const graph = await this.loadGraph();
        // Find the project
        const project = graph.entities.find(e => e.name === projectName && e.entityType === "project");
        if (!project) {
            throw new Error(`Project '${projectName}' not found`);
        }
        // Find all decision entities related to this project
        const decisions = [];
        // Direct decision relations to the project
        for (const relation of graph.relations) {
            if (relation.relationType === "related_to" && relation.to === projectName) {
                const decision = graph.entities.find(e => e.name === relation.from && e.entityType === "decision");
                if (decision) {
                    decisions.push(decision);
                }
            }
        }
        // Decisions related to components of the project
        const components = [];
        for (const relation of graph.relations) {
            if (relation.relationType === "contains" && relation.from === projectName) {
                const component = graph.entities.find(e => e.name === relation.to && e.entityType === "component");
                if (component) {
                    components.push(component);
                }
            }
        }
        for (const component of components) {
            for (const relation of graph.relations) {
                if (relation.relationType === "related_to" && relation.to === component.name) {
                    const decision = graph.entities.find(e => e.name === relation.from && e.entityType === "decision");
                    if (decision && !decisions.some(d => d.name === decision.name)) {
                        decisions.push(decision);
                    }
                }
            }
        }
        // Sort decisions chronologically if they have date observations
        const decisionsWithDates = decisions.map(decision => {
            const dateObs = decision.observations.find(o => o.startsWith('Date:'));
            return {
                decision,
                date: dateObs ? new Date(dateObs.split(':')[1].trim()) : new Date(0)
            };
        });
        decisionsWithDates.sort((a, b) => b.date.getTime() - a.date.getTime());
        return {
            project,
            decisions: decisionsWithDates.map(d => d.decision),
        };
    }
    // Get progress toward a milestone
    async getMilestoneProgress(milestoneName) {
        const graph = await this.loadGraph();
        // Find the milestone
        const milestone = graph.entities.find(e => e.name === milestoneName && e.entityType === "milestone");
        if (!milestone) {
            throw new Error(`Milestone '${milestoneName}' not found`);
        }
        // Find all tasks related to this milestone
        const tasks = [];
        for (const relation of graph.relations) {
            if (relation.relationType === "related_to" && relation.to === milestoneName) {
                const task = graph.entities.find(e => e.name === relation.from && e.entityType === "task");
                if (task) {
                    tasks.push(task);
                }
            }
        }
        // Get statuses for all tasks
        const statuses = {};
        // Load status for tasks
        for (const task of tasks) {
            const status = await this.getEntityStatus(task.name);
            if (status) {
                statuses[task.name] = status;
            }
        }
        // Group tasks by status
        const completedTasks = [];
        const inProgressTasks = [];
        const notStartedTasks = [];
        for (const task of tasks) {
            const status = statuses[task.name] || 'inactive';
            if (status === 'complete') {
                completedTasks.push(task);
            }
            else if (status === 'active') {
                inProgressTasks.push(task);
            }
            else {
                notStartedTasks.push(task);
            }
        }
        // Calculate progress percentage
        const totalTasks = tasks.length;
        const progressPercentage = totalTasks > 0
            ? Math.round((completedTasks.length / totalTasks) * 100)
            : 0;
        // Find task sequencing
        const taskSequencing = {};
        for (const task of tasks) {
            const precedingTasks = [];
            const followingTasks = [];
            // Find tasks that this task precedes
            for (const relation of graph.relations) {
                if (relation.from === task.name && relation.relationType === 'precedes') {
                    followingTasks.push(relation.to);
                }
                if (relation.to === task.name && relation.relationType === 'precedes') {
                    precedingTasks.push(relation.from);
                }
            }
            if (precedingTasks.length > 0 || followingTasks.length > 0) {
                taskSequencing[task.name] = {
                    precedingTasks,
                    followingTasks
                };
            }
        }
        // Determine if milestone can be considered complete
        const milestoneComplete = tasks.length > 0 && tasks.every(task => statuses[task.name] === 'complete');
        return {
            milestone,
            progress: {
                totalTasks,
                completedTasks: completedTasks.length,
                inProgressTasks: inProgressTasks.length,
                notStartedTasks: notStartedTasks.length,
                percentage: progressPercentage,
                complete: milestoneComplete
            },
            tasks: {
                completed: completedTasks,
                inProgress: inProgressTasks,
                notStarted: notStartedTasks
            },
            taskSequencing,
            statuses
        };
    }
}
// Main function to set up the MCP server
async function main() {
    try {
        const knowledgeGraphManager = new KnowledgeGraphManager();
        // Initialize status and priority entities
        await knowledgeGraphManager.initializeStatusAndPriority();
        // Initialize session states from persistent storage
        const sessionStates = await loadSessionStates();
        // Create the MCP server with a name and version
        const server = new McpServer({
            name: "Context Manager",
            version: "1.0.0"
        });
        // Define a resource that exposes the entire graph
        server.resource("graph", "graph://developer", async (uri) => ({
            contents: [{
                    uri: uri.href,
                    text: JSON.stringify(await knowledgeGraphManager.readGraph(), null, 2)
                }]
        }));
        // Define tools using zod for parameter validation
        // CRUD operations - these are now consolidated into buildcontext, deletecontext, and advancedcontext tools
        /**
         * Create new entities, relations, and observations.
         */
        server.tool("buildcontext", toolDescriptions["buildcontext"], {
            type: z.enum(["entities", "relations", "observations"]).describe("Type of creation operation: 'entities', 'relations', or 'observations'"),
            data: z.array(z.any()).describe("Data for the creation operation, structure varies by type but must be an array")
        }, async ({ type, data }) => {
            try {
                let result;
                switch (type) {
                    case "entities":
                        // Ensure entities match the Entity interface
                        const typedEntities = data.map((e) => ({
                            name: e.name,
                            entityType: e.entityType,
                            observations: e.observations
                        }));
                        result = await knowledgeGraphManager.createEntities(typedEntities);
                        return {
                            content: [{
                                    type: "text",
                                    text: JSON.stringify({ success: true, created: result }, null, 2)
                                }]
                        };
                    case "relations":
                        // Ensure relations match the Relation interface
                        const typedRelations = data.map((r) => ({
                            from: r.from,
                            to: r.to,
                            relationType: r.relationType
                        }));
                        result = await knowledgeGraphManager.createRelations(typedRelations);
                        return {
                            content: [{
                                    type: "text",
                                    text: JSON.stringify({ success: true, created: result }, null, 2)
                                }]
                        };
                    case "observations":
                        // Ensure observations match the required interface
                        const typedObservations = data.map((o) => ({
                            entityName: o.entityName,
                            contents: o.contents
                        }));
                        result = await knowledgeGraphManager.addObservations(typedObservations);
                        return {
                            content: [{
                                    type: "text",
                                    text: JSON.stringify({ success: true, added: result }, null, 2)
                                }]
                        };
                    default:
                        throw new Error(`Invalid type: ${type}. Must be 'entities', 'relations', or 'observations'.`);
                }
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: false,
                                error: error instanceof Error ? error.message : String(error)
                            }, null, 2)
                        }]
                };
            }
        });
        /**
         * Delete entities, relations, and observations.
         */
        server.tool("deletecontext", toolDescriptions["deletecontext"], {
            type: z.enum(["entities", "relations", "observations"]).describe("Type of deletion operation: 'entities', 'relations', or 'observations'"),
            data: z.array(z.any()).describe("Data for the deletion operation, structure varies by type but must be an array")
        }, async ({ type, data }) => {
            try {
                switch (type) {
                    case "entities":
                        await knowledgeGraphManager.deleteEntities(data);
                        return {
                            content: [{
                                    type: "text",
                                    text: JSON.stringify({ success: true, message: `Deleted ${data.length} entities` }, null, 2)
                                }]
                        };
                    case "relations":
                        // Ensure relations match the Relation interface
                        const typedRelations = data.map((r) => ({
                            from: r.from,
                            to: r.to,
                            relationType: r.relationType
                        }));
                        await knowledgeGraphManager.deleteRelations(typedRelations);
                        return {
                            content: [{
                                    type: "text",
                                    text: JSON.stringify({ success: true, message: `Deleted ${data.length} relations` }, null, 2)
                                }]
                        };
                    case "observations":
                        // Ensure deletions match the required interface
                        const typedDeletions = data.map((d) => ({
                            entityName: d.entityName,
                            observations: d.observations
                        }));
                        await knowledgeGraphManager.deleteObservations(typedDeletions);
                        return {
                            content: [{
                                    type: "text",
                                    text: JSON.stringify({ success: true, message: `Deleted observations from ${data.length} entities` }, null, 2)
                                }]
                        };
                    default:
                        throw new Error(`Invalid type: ${type}. Must be 'entities', 'relations', or 'observations'.`);
                }
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: false,
                                error: error instanceof Error ? error.message : String(error)
                            }, null, 2)
                        }]
                };
            }
        });
        /**
         * Get information about the graph, search for nodes, open nodes, get related entities, get decision history, and get milestone progress.
         */
        server.tool("advancedcontext", toolDescriptions["advancedcontext"], {
            type: z.enum(["graph", "search", "nodes", "related", "decisions", "milestone"]).describe("Type of get operation: 'graph', 'search', 'nodes', 'related', 'decisions', or 'milestone'"),
            params: z.record(z.string(), z.any()).describe("Parameters for the operation, structure varies by type")
        }, async ({ type, params }) => {
            try {
                let result;
                switch (type) {
                    case "graph":
                        result = await knowledgeGraphManager.readGraph();
                        return {
                            content: [{
                                    type: "text",
                                    text: JSON.stringify({ success: true, graph: result }, null, 2)
                                }]
                        };
                    case "search":
                        result = await knowledgeGraphManager.searchNodes(params.query);
                        return {
                            content: [{
                                    type: "text",
                                    text: JSON.stringify({ success: true, results: result }, null, 2)
                                }]
                        };
                    case "nodes":
                        result = await knowledgeGraphManager.openNodes(params.names);
                        return {
                            content: [{
                                    type: "text",
                                    text: JSON.stringify({ success: true, nodes: result }, null, 2)
                                }]
                        };
                    case "related":
                        result = await knowledgeGraphManager.getRelatedEntities(params.entityName, params.relationTypes);
                        return {
                            content: [{
                                    type: "text",
                                    text: JSON.stringify({ success: true, entities: result }, null, 2)
                                }]
                        };
                    case "decisions":
                        result = await knowledgeGraphManager.getDecisionHistory(params.projectName);
                        return {
                            content: [{
                                    type: "text",
                                    text: JSON.stringify({ success: true, decisions: result }, null, 2)
                                }]
                        };
                    case "milestone":
                        result = await knowledgeGraphManager.getMilestoneProgress(params.milestoneName);
                        return {
                            content: [{
                                    type: "text",
                                    text: JSON.stringify({ success: true, progress: result }, null, 2)
                                }]
                        };
                    default:
                        throw new Error(`Invalid type: ${type}. Must be 'graph', 'search', 'nodes', 'related', 'decisions', or 'milestone'.`);
                }
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: false,
                                error: error instanceof Error ? error.message : String(error)
                            }, null, 2)
                        }]
                };
            }
        });
        /**
         * Start a new development session. Returns session ID, recent development sessions, active projects, high-priority tasks, and upcoming milestones.
         * The output allows the user to easily choose what to focus on and which specific context to load.
         */
        server.tool("startsession", toolDescriptions["startsession"], {}, async () => {
            try {
                // Generate a unique session ID
                const sessionId = generateSessionId();
                // Get recent sessions from persistent storage
                const sessionStates = await loadSessionStates();
                // Initialize the session state
                sessionStates.set(sessionId, []);
                await saveSessionStates(sessionStates);
                // Convert sessions map to array, sort by date, and take most recent ones
                const recentSessions = Array.from(sessionStates.entries())
                    .map(([id, stages]) => {
                    // Extract summary data from the first stage (if it exists)
                    const summaryStage = stages.find(s => s.stage === "summary");
                    return {
                        id,
                        project: summaryStage?.stageData?.project || "Unknown project",
                        focus: summaryStage?.stageData?.focus || "Unknown focus",
                        summary: summaryStage?.stageData?.summary || "No summary available"
                    };
                })
                    .slice(0, 3); // Default to showing 3 recent sessions
                // Get active development projects
                const graph = await knowledgeGraphManager.readGraph();
                const activeProjects = [];
                // Find projects with active status
                for (const entity of graph.entities) {
                    if (entity.entityType === 'project') {
                        const status = await knowledgeGraphManager.getEntityStatus(entity.name);
                        if (status === 'active') {
                            activeProjects.push(entity);
                        }
                    }
                }
                // Get high-priority development tasks
                const highPriorityTasks = [];
                // Find tasks with high priority and active status
                for (const entity of graph.entities) {
                    if (entity.entityType === 'task') {
                        const status = await knowledgeGraphManager.getEntityStatus(entity.name);
                        const priority = await knowledgeGraphManager.getEntityPriority(entity.name);
                        if (status === 'active' && priority === 'high') {
                            highPriorityTasks.push(entity);
                        }
                    }
                }
                // Get upcoming milestones
                const upcomingMilestones = [];
                // Find milestones with active status
                for (const entity of graph.entities) {
                    if (entity.entityType === 'milestone') {
                        const status = await knowledgeGraphManager.getEntityStatus(entity.name);
                        if (status === 'active') {
                            upcomingMilestones.push(entity);
                        }
                    }
                }
                let sessionsText = "No recent sessions found.";
                if (recentSessions.length > 0) {
                    sessionsText = recentSessions.map(session => `- ${session.project} - ${session.focus} - ${session.summary.substring(0, 100)}${session.summary.length > 100 ? '...' : ''}`).join('\n');
                }
                let projectsText = "No active projects found.";
                if (activeProjects.length > 0) {
                    projectsText = activeProjects.map(project => {
                        const obsPreview = project.observations.length > 0 ?
                            `: ${project.observations[0].substring(0, 60)}${project.observations[0].length > 60 ? '...' : ''}` : '';
                        return `- ${project.name}${obsPreview}`;
                    }).join('\n');
                }
                let tasksText = "No high-priority tasks found.";
                if (highPriorityTasks.length > 0) {
                    tasksText = highPriorityTasks.map(task => {
                        const obsPreview = task.observations.length > 0 ?
                            `: ${task.observations[0].substring(0, 60)}${task.observations[0].length > 60 ? '...' : ''}` : '';
                        return `- ${task.name}${obsPreview}`;
                    }).join('\n');
                }
                let milestonesText = "No upcoming milestones found.";
                if (upcomingMilestones.length > 0) {
                    milestonesText = upcomingMilestones.map(milestone => {
                        const obsPreview = milestone.observations.length > 0 ?
                            `: ${milestone.observations[0].substring(0, 60)}${milestone.observations[0].length > 60 ? '...' : ''}` : '';
                        return `- ${milestone.name}${obsPreview}`;
                    }).join('\n');
                }
                return {
                    content: [{
                            type: "text",
                            text: `# Ask user to choose what to focus on in this session. Present the following options:

## Recent Development Sessions
${sessionsText}

## Active Projects
${projectsText}

## High-Priority Tasks
${tasksText}

## Upcoming Milestones
${milestonesText}

To load specific context based on the user's choice, use the \`loadcontext\` tool with the entity name and developer session ID - ${sessionId}.`
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: false,
                                error: error instanceof Error ? error.message : String(error)
                            }, null, 2)
                        }]
                };
            }
        });
        /**
         * Load the context for a specific entity.
         * Valid entity types are: project, component, task, issue, milestone, decision, feature, technology, documentation, dependency.
         */
        server.tool("loadcontext", toolDescriptions["loadcontext"], {
            entityName: z.string(),
            entityType: z.string().optional(),
            sessionId: z.string().optional()
        }, async ({ entityName, entityType = "project", sessionId }) => {
            try {
                // Validate session if ID is provided
                if (sessionId) {
                    const sessionStates = await loadSessionStates();
                    if (!sessionStates.has(sessionId)) {
                        console.warn(`Warning: Session ${sessionId} not found, but proceeding with context load`);
                        // Initialize it anyway for more robustness
                        sessionStates.set(sessionId, []);
                        await saveSessionStates(sessionStates);
                    }
                    // Track that this entity was loaded in this session
                    const sessionState = sessionStates.get(sessionId) || [];
                    const loadEvent = {
                        type: 'context_loaded',
                        timestamp: new Date().toISOString(),
                        entityName,
                        entityType
                    };
                    sessionState.push(loadEvent);
                    sessionStates.set(sessionId, sessionState);
                    await saveSessionStates(sessionStates);
                }
                // Get entity
                const entityGraph = await knowledgeGraphManager.searchNodes(entityName);
                if (entityGraph.entities.length === 0) {
                    throw new Error(`Entity ${entityName} not found`);
                }
                // Find the exact entity by name (case-sensitive match)
                const entity = entityGraph.entities.find(e => e.name === entityName);
                if (!entity) {
                    throw new Error(`Entity ${entityName} not found`);
                }
                // Get status and priority
                const status = await knowledgeGraphManager.getEntityStatus(entityName) || "unknown";
                const priority = await knowledgeGraphManager.getEntityPriority(entityName);
                // Format observations for display (show all observations)
                const observationsList = entity.observations.length > 0
                    ? entity.observations.map(obs => `- ${obs}`).join("\n")
                    : "No observations";
                // Different context loading based on entity type
                let contextMessage = "";
                if (entityType === "project") {
                    // Get project status
                    const projectStatus = await knowledgeGraphManager.getProjectStatus(entityName);
                    // Format project context
                    const componentsText = projectStatus.components?.map((component) => {
                        return `- **${component.name}**${component.observations.length > 0 ? `: ${component.observations[0]}` : ''}`;
                    }).join("\n") || "No components found";
                    const featuresText = projectStatus.activeFeatures?.map((feature) => {
                        const featureStatus = projectStatus.statuses[feature.name] || "unknown";
                        return `- **${feature.name}** (${featureStatus})${feature.observations.length > 0 ? `: ${feature.observations.join(', ')}` : ''}`;
                    }).join("\n") || "No active features found";
                    const tasksText = projectStatus.activeTasks?.map((task) => {
                        const taskStatus = projectStatus.statuses[task.name] || "unknown";
                        const taskPriority = projectStatus.priorities[task.name] || "normal";
                        return `- **${task.name}** (${taskStatus}, ${taskPriority} priority)${task.observations.length > 0 ? `: ${task.observations.join(', ')}` : ''}`;
                    }).join("\n") || "No active tasks found";
                    const issuesText = projectStatus.activeIssues?.map((issue) => {
                        const issueStatus = projectStatus.statuses[issue.name] || "unknown";
                        return `- **${issue.name}** (${issueStatus})${issue.observations.length > 0 ? `: ${issue.observations.join(', ')}` : ''}`;
                    }).join("\n") || "No active issues found";
                    const milestonesText = projectStatus.upcomingMilestones?.map((milestone) => {
                        const milestoneStatus = projectStatus.statuses[milestone.name] || "unknown";
                        return `- **${milestone.name}** (${milestoneStatus})${milestone.observations.length > 0 ? `: ${milestone.observations.join(', ')}` : ''}`;
                    }).join("\n") || "No upcoming milestones found";
                    const decisionsText = projectStatus.recentDecisions?.map((decision) => {
                        return `- **${decision.name}**${decision.observations.length > 0 ? `: ${decision.observations.join(', ')}` : ''}`;
                    }).join("\n") || "No recent decisions";
                    // Task sequencing information
                    const sequencingText = Object.keys(projectStatus.taskSequencing || {}).length > 0
                        ? Object.entries(projectStatus.taskSequencing).map(([taskName, sequence]) => {
                            return `- **${taskName}**:\n  - Precedes: ${sequence.followingTasks.length > 0 ? sequence.followingTasks.join(', ') : 'None'}\n  - Follows: ${sequence.precedingTasks.length > 0 ? sequence.precedingTasks.join(', ') : 'None'}`;
                        }).join("\n")
                        : "No task sequencing information available";
                    contextMessage = `# Software Development Project Context: ${entityName}

## Project Overview
- **Status**: ${status}
- **Priority**: ${priority || "N/A"}

## Observations
${observationsList}

## Components
${componentsText}

## Active Features
${featuresText}

## Active Tasks
${tasksText}

## Active Issues
${issuesText}

## Upcoming Milestones
${milestonesText}

## Recent Decisions
${decisionsText}

## Task Sequencing
${sequencingText}`;
                }
                else if (entityType === "component") {
                    // Get component context
                    const componentContext = await knowledgeGraphManager.getComponentContext(entityName);
                    const projectsText = componentContext.projects?.map((project) => {
                        return `- **${project.name}**${project.observations.length > 0 ? `: ${project.observations.join(', ')}` : ''}`;
                    }).join("\n") || "No parent projects found";
                    const featuresText = componentContext.features?.map((feature) => {
                        const featureStatus = componentContext.statuses[feature.name] || "unknown";
                        return `- **${feature.name}** (${featureStatus})${feature.observations.length > 0 ? `: ${feature.observations.join(', ')}` : ''}`;
                    }).join("\n") || "No implemented features found";
                    const technologiesText = componentContext.technologies?.map((tech) => {
                        return `- **${tech.name}**${tech.observations.length > 0 ? `: ${tech.observations.join(', ')}` : ''}`;
                    }).join("\n") || "No technologies specified";
                    const issuesText = componentContext.activeIssues?.map((issue) => {
                        const issueStatus = componentContext.statuses[issue.name] || "unknown";
                        return `- **${issue.name}** (${issueStatus})${issue.observations.length > 0 ? `: ${issue.observations.join(', ')}` : ''}`;
                    }).join("\n") || "No active issues found";
                    const dependenciesText = componentContext.dependencies?.map((dep) => {
                        return `- **${dep.name}** (${dep.entityType})${dep.observations.length > 0 ? `: ${dep.observations.join(', ')}` : ''}`;
                    }).join("\n") || "No dependencies found";
                    const documentationText = componentContext.documentation?.map((doc) => {
                        return `- **${doc.name}**${doc.observations.length > 0 ? `: ${doc.observations.join(', ')}` : ''}`;
                    }).join("\n") || "No documentation found";
                    contextMessage = `# Component Context: ${entityName}

## Overview
- **Status**: ${status}
- **Priority**: ${priority || "N/A"}

## Observations
${observationsList}

## Part of Projects
${projectsText}

## Technologies
${technologiesText}

## Implemented Features
${featuresText}

## Dependencies
${dependenciesText}

## Active Issues
${issuesText}

## Documentation
${documentationText}`;
                }
                else if (entityType === "feature") {
                    // Get related entities
                    const relatedEntities = await knowledgeGraphManager.getRelatedEntities(entityName);
                    // Find implementing components
                    const implementingComponents = relatedEntities.incomingRelations
                        .filter((rel) => rel.relation.relationType === "implements")
                        .map((rel) => rel.source);
                    const componentsText = implementingComponents.map((component) => {
                        return `- **${component.name}**${component.observations.length > 0 ? `: ${component.observations.join(', ')}` : ''}`;
                    }).join("\n") || "No implementing components found";
                    // Find related tasks
                    const relatedTasks = [...relatedEntities.incomingRelations, ...relatedEntities.outgoingRelations]
                        .filter((rel) => rel.relation.relationType === "related_to" &&
                        (rel.source?.entityType === "task" || rel.target?.entityType === "task"))
                        .map((rel) => rel.source?.entityType === "task" ? rel.source : rel.target)
                        .filter((entity) => entity !== undefined);
                    // Get status for each task
                    const taskStatuses = {};
                    for (const task of relatedTasks) {
                        const taskStatus = await knowledgeGraphManager.getEntityStatus(task.name);
                        if (taskStatus) {
                            taskStatuses[task.name] = taskStatus;
                        }
                    }
                    const tasksText = relatedTasks.map((task) => {
                        const taskStatus = taskStatuses[task.name] || "unknown";
                        return `- **${task.name}** (${taskStatus})${task.observations.length > 0 ? `: ${task.observations.join(', ')}` : ''}`;
                    }).join("\n") || "No related tasks found";
                    // Find requirements
                    const requirements = relatedEntities.incomingRelations
                        .filter((rel) => rel.relation.relationType === "required_by")
                        .map((rel) => rel.source);
                    const requirementsText = requirements.map((req) => {
                        return `- **${req.name}**${req.observations.length > 0 ? `: ${req.observations.join(', ')}` : ''}`;
                    }).join("\n") || "No requirements specified";
                    contextMessage = `# Feature Context: ${entityName}

## Overview
- **Status**: ${status}
- **Priority**: ${priority || "normal"}

## Observations
${observationsList}

## Requirements
${requirementsText}

## Implementing Components
${componentsText}

## Related Tasks
${tasksText}`;
                }
                else if (entityType === "task") {
                    // Get related entities
                    const relatedEntities = await knowledgeGraphManager.getRelatedEntities(entityName);
                    // Find related issues
                    const relatedIssues = relatedEntities.outgoingRelations
                        .filter((rel) => rel.relation.relationType === "resolves")
                        .map((rel) => rel.target);
                    // Get status for each issue
                    const issueStatuses = {};
                    for (const issue of relatedIssues) {
                        const issueStatus = await knowledgeGraphManager.getEntityStatus(issue.name);
                        if (issueStatus) {
                            issueStatuses[issue.name] = issueStatus;
                        }
                    }
                    const issuesText = relatedIssues.map((issue) => {
                        const issueStatus = issueStatuses[issue.name] || "unknown";
                        return `- **${issue.name}** (${issueStatus})${issue.observations.length > 0 ? `: ${issue.observations.join(', ')}` : ''}`;
                    }).join("\n") || "No related issues found";
                    // Find parent project
                    const parentProjects = relatedEntities.incomingRelations
                        .filter((rel) => rel.relation.relationType === "contains" && rel.source.entityType === "project")
                        .map((rel) => rel.source);
                    const projectName = parentProjects.length > 0 ? parentProjects[0].name : "Unknown project";
                    // Find blocking tasks or issues
                    const blockingItems = relatedEntities.outgoingRelations
                        .filter((rel) => rel.relation.relationType === "blocked_by")
                        .map((rel) => rel.target);
                    // Get status for each blocking item
                    const blockingStatuses = {};
                    for (const item of blockingItems) {
                        const itemStatus = await knowledgeGraphManager.getEntityStatus(item.name);
                        if (itemStatus) {
                            blockingStatuses[item.name] = itemStatus;
                        }
                    }
                    const blockingText = blockingItems.map((item) => {
                        const itemStatus = blockingStatuses[item.name] || "unknown";
                        return `- **${item.name}** (${item.entityType}, ${itemStatus})${item.observations.length > 0 ? `: ${item.observations.join(', ')}` : ''}`;
                    }).join("\n") || "No blocking items";
                    // Find task sequencing
                    const precedingTasks = [];
                    const followingTasks = [];
                    // Get the graph to find sequencing relations
                    const graph = await knowledgeGraphManager.readGraph();
                    for (const relation of graph.relations) {
                        if (relation.from === entityName && relation.relationType === 'precedes') {
                            followingTasks.push(relation.to);
                        }
                        if (relation.to === entityName && relation.relationType === 'precedes') {
                            precedingTasks.push(relation.from);
                        }
                    }
                    const sequencingText = `### Preceding Tasks\n${precedingTasks.length > 0 ? precedingTasks.map(t => `- ${t}`).join('\n') : 'None'}\n\n### Following Tasks\n${followingTasks.length > 0 ? followingTasks.map(t => `- ${t}`).join('\n') : 'None'}`;
                    contextMessage = `# Task Context: ${entityName}

## Overview
- **Project**: ${projectName}
- **Status**: ${status}
- **Priority**: ${priority || "normal"}

## Observations
${observationsList}

## Related Issues
${issuesText}

## Blocked By
${blockingText}

## Task Sequencing
${sequencingText}`;
                }
                else if (entityType === "milestone") {
                    // Get milestone progress
                    const milestoneProgress = await knowledgeGraphManager.getMilestoneProgress(entityName);
                    contextMessage = `# Milestone Context: ${entityName}

## Overview
- **Status**: ${status}
- **Progress**: ${milestoneProgress.progress?.percentage || 0}% complete
- **Complete**: ${milestoneProgress.progress?.complete ? "Yes" : "No"}

## Observations
${observationsList}

## Tasks
### Completed (${milestoneProgress.tasks?.completed?.length || 0})
${milestoneProgress.tasks?.completed?.map((task) => {
                        return `- **${task.name}**${task.observations.length > 0 ? `: ${task.observations.join(', ')}` : ''}`;
                    }).join("\n") || "No completed tasks"}

### In Progress (${milestoneProgress.tasks?.inProgress?.length || 0})
${milestoneProgress.tasks?.inProgress?.map((task) => {
                        return `- **${task.name}**${task.observations.length > 0 ? `: ${task.observations.join(', ')}` : ''}`;
                    }).join("\n") || "No in-progress tasks"}

### Not Started (${milestoneProgress.tasks?.notStarted?.length || 0})
${milestoneProgress.tasks?.notStarted?.map((task) => {
                        return `- **${task.name}**${task.observations.length > 0 ? `: ${task.observations.join(', ')}` : ''}`;
                    }).join("\n") || "No not-started tasks"}

## Task Sequencing
${Object.keys(milestoneProgress.taskSequencing || {}).length > 0
                        ? Object.entries(milestoneProgress.taskSequencing).map(([taskName, sequence]) => {
                            return `- **${taskName}**:\n  - Precedes: ${sequence.followingTasks.length > 0 ? sequence.followingTasks.join(', ') : 'None'}\n  - Follows: ${sequence.precedingTasks.length > 0 ? sequence.precedingTasks.join(', ') : 'None'}`;
                        }).join("\n")
                        : "No task sequencing information available"}`;
                }
                return {
                    content: [{
                            type: "text",
                            text: contextMessage
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: false,
                                error: error instanceof Error ? error.message : String(error)
                            }, null, 2)
                        }]
                };
            }
        });
        // Helper function to process each stage of endsession
        async function processStage(params, previousStages) {
            // Process based on the stage
            switch (params.stage) {
                case "summary":
                    // Process summary stage
                    return {
                        stage: "summary",
                        stageNumber: params.stageNumber,
                        analysis: params.analysis || "",
                        stageData: params.stageData || {
                            summary: "",
                            duration: "",
                            focus: ""
                        },
                        completed: !params.nextStageNeeded
                    };
                case "achievements":
                    // Process achievements stage
                    return {
                        stage: "achievements",
                        stageNumber: params.stageNumber,
                        analysis: params.analysis || "",
                        stageData: params.stageData || { achievements: [] },
                        completed: !params.nextStageNeeded
                    };
                case "taskUpdates":
                    // Process task updates stage
                    return {
                        stage: "taskUpdates",
                        stageNumber: params.stageNumber,
                        analysis: params.analysis || "",
                        stageData: params.stageData || { taskUpdates: [] },
                        completed: !params.nextStageNeeded
                    };
                case "newTasks":
                    // Process new tasks stage
                    return {
                        stage: "newTasks",
                        stageNumber: params.stageNumber,
                        analysis: params.analysis || "",
                        stageData: params.stageData || { newTasks: [] },
                        completed: !params.nextStageNeeded
                    };
                case "projectStatus":
                    // Process project status stage
                    return {
                        stage: "projectStatus",
                        stageNumber: params.stageNumber,
                        analysis: params.analysis || "",
                        stageData: params.stageData || {
                            projectName: "",
                            projectStatus: "",
                            projectObservation: ""
                        },
                        completed: !params.nextStageNeeded
                    };
                case "assembly":
                    // Final assembly stage - compile all arguments for end session
                    return {
                        stage: "assembly",
                        stageNumber: params.stageNumber,
                        analysis: "Final assembly of endsession arguments",
                        stageData: assembleEndSessionArgs(previousStages),
                        completed: true
                    };
                default:
                    throw new Error(`Unknown stage: ${params.stage}`);
            }
        }
        // Helper function to assemble the final end session arguments
        function assembleEndSessionArgs(stages) {
            const summaryStage = stages.find(s => s.stage === "summary");
            const achievementsStage = stages.find(s => s.stage === "achievements");
            const taskUpdatesStage = stages.find(s => s.stage === "taskUpdates");
            const newTasksStage = stages.find(s => s.stage === "newTasks");
            const projectStatusStage = stages.find(s => s.stage === "projectStatus");
            return {
                summary: summaryStage?.stageData?.summary || "",
                duration: summaryStage?.stageData?.duration || "unknown",
                focus: summaryStage?.stageData?.focus || "",
                achievements: JSON.stringify(achievementsStage?.stageData?.achievements || []),
                taskUpdates: JSON.stringify(taskUpdatesStage?.stageData?.taskUpdates || []),
                projectName: projectStatusStage?.stageData?.projectName || "",
                projectStatus: projectStatusStage?.stageData?.projectStatus || "",
                projectObservation: projectStatusStage?.stageData?.projectObservation || "",
                newTasks: JSON.stringify(newTasksStage?.stageData?.newTasks || [])
            };
        }
        /**
         * End session by processing all stages and recording the final results.
         * Only use this tool if the user asks for it.
         *
         * Usage examples:
         *
         * 1. Starting the end session process with the summary stage:
         * {
         *   "sessionId": "dev_1234567890_abc123",  // From startsession
         *   "stage": "summary",
         *   "stageNumber": 1,
         *   "totalStages": 6,  // Total stages you plan to use
         *   "analysis": "Analyzed progress on the authentication system",
         *   "stageData": {
         *     "summary": "Completed the login functionality and fixed related bugs",
         *     "duration": "3 hours",
         *     "focus": "AuthSystem"  // Project/component name
         *   },
         *   "nextStageNeeded": true,  // More stages coming
         *   "isRevision": false
         * }
         *
         * 2. Middle stage for achievements:
         * {
         *   "sessionId": "dev_1234567890_abc123",
         *   "stage": "achievements",
         *   "stageNumber": 2,
         *   "totalStages": 6,
         *   "analysis": "Listed key accomplishments",
         *   "stageData": {
         *     "achievements": [
         *       "Implemented password reset functionality",
         *       "Fixed login redirect bug",
         *       "Added error handling for authentication failures"
         *     ]
         *   },
         *   "nextStageNeeded": true,
         *   "isRevision": false
         * }
         *
         * 3. Final assembly stage:
         * {
         *   "sessionId": "dev_1234567890_abc123",
         *   "stage": "assembly",
         *   "stageNumber": 6,
         *   "totalStages": 6,
         *   "nextStageNeeded": false,  // This completes the session
         *   "isRevision": false
         * }
         */
        server.tool("endsession", toolDescriptions["endsession"], {
            sessionId: z.string().describe("The unique session identifier obtained from startsession"),
            stage: z.string().describe("Current stage of analysis: 'summary', 'achievements', 'taskUpdates', 'newTasks', 'projectStatus', or 'assembly'"),
            stageNumber: z.number().int().positive().describe("The sequence number of the current stage (starts at 1)"),
            totalStages: z.number().int().positive().describe("Total number of stages in the workflow (typically 6 for standard workflow)"),
            analysis: z.string().optional().describe("Text analysis or observations for the current stage"),
            stageData: z.record(z.string(), z.any()).optional().describe(`Stage-specific data structure - format depends on the stage type:
        - For 'summary' stage: { summary: "Session summary text", duration: "2 hours", focus: "ProjectName" }
        - For 'achievements' stage: { achievements: ["Implemented feature X", "Fixed bug Y", "Refactored component Z"] }
        - For 'taskUpdates' stage: { taskUpdates: [{ name: "Task1", status: "completed" }, { name: "Task2", status: "in_progress" }] }
        - For 'newTasks' stage: { newTasks: [{ name: "NewTask1", description: "Implement feature A", priority: "high" }] }
        - For 'projectStatus' stage: { projectName: "ProjectName", projectStatus: "in_progress", projectObservation: "Making good progress" }
        - For 'assembly' stage: no stageData needed - automatic assembly of previous stages`),
            nextStageNeeded: z.boolean().describe("Whether additional stages are needed after this one (false for final stage)"),
            isRevision: z.boolean().optional().describe("Whether this is revising a previous stage"),
            revisesStage: z.number().int().positive().optional().describe("If revising, which stage number is being revised")
        }, async (params) => {
            try {
                // Load session states from persistent storage
                const sessionStates = await loadSessionStates();
                // Validate session ID
                if (!sessionStates.has(params.sessionId)) {
                    return {
                        content: [{
                                type: "text",
                                text: JSON.stringify({
                                    success: false,
                                    error: `Session with ID ${params.sessionId} not found. Please start a new session with startsession.`
                                }, null, 2)
                            }]
                    };
                }
                // Get or initialize session state
                let sessionState = sessionStates.get(params.sessionId) || [];
                // Process the current stage
                const stageResult = await processStage(params, sessionState);
                // Store updated state
                if (params.isRevision && params.revisesStage) {
                    // Find the analysis stages in the session state
                    const analysisStages = sessionState.filter(item => item.type === 'analysis_stage') || [];
                    if (params.revisesStage <= analysisStages.length) {
                        // Replace the revised stage
                        analysisStages[params.revisesStage - 1] = {
                            type: 'analysis_stage',
                            ...stageResult
                        };
                    }
                    else {
                        // Add as a new stage
                        analysisStages.push({
                            type: 'analysis_stage',
                            ...stageResult
                        });
                    }
                    // Update the session state with the modified analysis stages
                    sessionState = [
                        ...sessionState.filter(item => item.type !== 'analysis_stage'),
                        ...analysisStages
                    ];
                }
                else {
                    // Add new stage
                    sessionState.push({
                        type: 'analysis_stage',
                        ...stageResult
                    });
                }
                // Update in-memory and persistent storage
                sessionStates.set(params.sessionId, sessionState);
                await saveSessionStates(sessionStates);
                // Check if this is the final assembly stage and no more stages are needed
                if (params.stage === "assembly" && !params.nextStageNeeded) {
                    // Get the assembled arguments
                    const args = stageResult.stageData;
                    try {
                        // Parse arguments
                        const summary = args.summary;
                        const duration = args.duration;
                        const focus = args.focus;
                        const achievements = args.achievements ? JSON.parse(args.achievements) : [];
                        const taskUpdates = args.taskUpdates ? JSON.parse(args.taskUpdates) : [];
                        const projectUpdate = {
                            name: args.projectName,
                            status: args.projectStatus,
                            observation: args.projectObservation
                        };
                        const newTasks = args.newTasks ? JSON.parse(args.newTasks) : [];
                        // 2. Create achievement entities and link to focus project
                        const achievementEntities = achievements.map((achievement, i) => ({
                            name: `Achievement_${new Date().getTime()}_${i + 1}`,
                            entityType: "decision",
                            observations: [achievement]
                        }));
                        if (achievementEntities.length > 0) {
                            await knowledgeGraphManager.createEntities(achievementEntities);
                            // Link achievements to focus project
                            const achievementRelations = achievementEntities.map((achievement) => ({
                                from: focus,
                                to: achievement.name,
                                relationType: "contains"
                            }));
                            await knowledgeGraphManager.createRelations(achievementRelations);
                        }
                        // 3. Update task statuses
                        for (const task of taskUpdates) {
                            // First find the task entity
                            const taskGraph = await knowledgeGraphManager.searchNodes(`name:${task.name}`);
                            if (taskGraph.entities.length > 0) {
                                // Update the status observation
                                const taskEntity = taskGraph.entities[0];
                                // Set task status
                                try {
                                    const statusValue = task.status === "completed" || task.status === "complete" ? "complete" :
                                        task.status === "in_progress" ? "active" : "inactive";
                                    await knowledgeGraphManager.setEntityStatus(task.name, statusValue);
                                }
                                catch (error) {
                                    console.error(`Error updating status for task ${task.name}: ${error}`);
                                }
                                // If completed, link to this session
                                if (task.status === "complete" || task.status === "completed") {
                                    await knowledgeGraphManager.createRelations([{
                                            from: focus,
                                            to: task.name,
                                            relationType: "resolves"
                                        }]);
                                }
                            }
                        }
                        // 4. Update project status
                        const projectGraph = await knowledgeGraphManager.searchNodes(`name:${projectUpdate.name}`);
                        if (projectGraph.entities.length > 0) {
                            const projectEntity = projectGraph.entities[0];
                            // Add project observation if specified
                            if (projectUpdate.observation) {
                                await knowledgeGraphManager.addObservations([{
                                        entityName: projectUpdate.name,
                                        contents: [projectUpdate.observation]
                                    }]);
                            }
                            // Set project status
                            try {
                                const statusValue = projectUpdate.status === "completed" || projectUpdate.status === "complete" ? "complete" :
                                    projectUpdate.status === "in_progress" || projectUpdate.status === "active" ? "active" : "inactive";
                                await knowledgeGraphManager.setEntityStatus(projectUpdate.name, statusValue);
                            }
                            catch (error) {
                                console.error(`Error updating status for project ${projectUpdate.name}: ${error}`);
                            }
                        }
                        // 5. Create new tasks
                        if (newTasks && newTasks.length > 0) {
                            const taskEntities = newTasks.map((task, i) => ({
                                name: task.name,
                                entityType: "task",
                                observations: [
                                    task.description
                                ]
                            }));
                            await knowledgeGraphManager.createEntities(taskEntities);
                            // Set status, priority, and sequencing for each task
                            for (const task of newTasks) {
                                // Set task status to active by default
                                try {
                                    await knowledgeGraphManager.setEntityStatus(task.name, "active");
                                }
                                catch (error) {
                                    console.error(`Error setting status for new task ${task.name}: ${error}`);
                                }
                                // Set task priority if specified
                                if (task.priority) {
                                    try {
                                        const priorityValue = task.priority.toLowerCase() === "high" ? "high" : "low";
                                        await knowledgeGraphManager.setEntityPriority(task.name, priorityValue);
                                    }
                                    catch (error) {
                                        console.error(`Error setting priority for new task ${task.name}: ${error}`);
                                    }
                                }
                                // Create sequencing relationships if specified
                                try {
                                    // This task precedes another task
                                    if (task.precedes) {
                                        await knowledgeGraphManager.createRelations([{
                                                from: task.name,
                                                to: task.precedes,
                                                relationType: "precedes"
                                            }]);
                                    }
                                    // This task follows another task
                                    if (task.follows) {
                                        await knowledgeGraphManager.createRelations([{
                                                from: task.follows,
                                                to: task.name,
                                                relationType: "precedes"
                                            }]);
                                    }
                                }
                                catch (error) {
                                    console.error(`Error setting sequencing for task ${task.name}: ${error}`);
                                }
                            }
                            // Link tasks to project
                            const taskRelations = taskEntities.map((task) => ({
                                from: projectUpdate.name,
                                to: task.name,
                                relationType: "contains"
                            }));
                            await knowledgeGraphManager.createRelations(taskRelations);
                        }
                        // Record session completion in persistent storage
                        sessionState.push({
                            type: 'session_completed',
                            timestamp: new Date().toISOString(),
                            summary: summary,
                            project: focus
                        });
                        sessionStates.set(params.sessionId, sessionState);
                        await saveSessionStates(sessionStates);
                        // Prepare the summary message
                        const summaryMessage = `# Development Session Recorded

I've recorded your development session focusing on ${focus}.

## Achievements Documented
${achievements.map((a) => `- ${a}`).join('\n') || "No achievements recorded."}

## Task Updates
${taskUpdates.map((t) => `- ${t.name}: ${t.status}`).join('\n') || "No task updates."}

## Project Status
Project ${projectUpdate.name} has been updated to: ${projectUpdate.status}

${newTasks && newTasks.length > 0 ? `## New Tasks Added
${newTasks.map((t) => `- ${t.name}: ${t.description} (Priority: ${t.priority || "medium"})`).join('\n')}` : "No new tasks added."}

## Session Summary
${summary}

Would you like me to perform any additional updates to the development knowledge graph?`;
                        // Return the final result with the session recorded message
                        return {
                            content: [{
                                    type: "text",
                                    text: JSON.stringify({
                                        success: true,
                                        stageCompleted: params.stage,
                                        nextStageNeeded: false,
                                        stageResult: stageResult,
                                        sessionRecorded: true,
                                        summaryMessage: summaryMessage
                                    }, null, 2)
                                }]
                        };
                    }
                    catch (error) {
                        return {
                            content: [{
                                    type: "text",
                                    text: JSON.stringify({
                                        success: false,
                                        error: `Error recording development session: ${error instanceof Error ? error.message : String(error)}`
                                    }, null, 2)
                                }]
                        };
                    }
                }
                else {
                    // This is not the final stage or more stages are needed
                    // Return intermediate result
                    return {
                        content: [{
                                type: "text",
                                text: JSON.stringify({
                                    success: true,
                                    stageCompleted: params.stage,
                                    nextStageNeeded: params.nextStageNeeded,
                                    stageResult: stageResult,
                                    endSessionArgs: params.stage === "assembly" ? stageResult.stageData : null
                                }, null, 2)
                            }]
                    };
                }
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: false,
                                error: error instanceof Error ? error.message : String(error)
                            }, null, 2)
                        }]
                };
            }
        });
        // Connect the server to the transport
        const transport = new StdioServerTransport();
        await server.connect(transport);
    }
    catch (error) {
        console.error("Error starting server:", error);
        process.exit(1);
    }
}
// Run the main function
main().catch(error => {
    console.error("Unhandled error:", error);
    process.exit(1);
});
// Export the KnowledgeGraphManager for testing
export { KnowledgeGraphManager };
