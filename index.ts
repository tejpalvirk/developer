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
    ? process.env.MEMORY_FILE_PATH  // Use absolute path as is
    : path.join(process.cwd(), process.env.MEMORY_FILE_PATH)  // Relative to current working directory
  : defaultMemoryPath;  // Default fallback

// Properly handle absolute and relative paths for SESSIONS_FILE_PATH
const SESSIONS_FILE_PATH = process.env.SESSIONS_FILE_PATH
  ? path.isAbsolute(process.env.SESSIONS_FILE_PATH)
    ? process.env.SESSIONS_FILE_PATH  // Use absolute path as is
    : path.join(process.cwd(), process.env.SESSIONS_FILE_PATH)  // Relative to current working directory
  : defaultSessionsPath;  // Default fallback

// Software Development specific entity types
const VALID_ENTITY_TYPES = [
  'project',       // Overall software project
  'component',     // Module, service, or package within a project
  'feature',       // Specific functionality being developed
  'issue',         // Bug or problem to be fixed
  'task',          // Work item or activity needed for development
  'developer',     // Team member working on the project
  'technology',    // Language, framework, or tool used
  'decision',      // Important technical or architectural decision
  'milestone',     // Key project deadline or phase
  'environment',   // Development, staging, production environments
  'documentation', // Project documentation
  'requirement'    // Project requirement or specification
];

// Software Development specific relation types
const VALID_RELATION_TYPES = [
  'depends_on',     // Dependency relationship
  'implements',     // Component implements a feature
  'assigned_to',    // Task is assigned to a developer
  'blocked_by',     // Task is blocked by an issue
  'uses',           // Component uses a technology
  'part_of',        // Component is part of a project
  'contains',       // Project contains a component
  'works_on',       // Developer works on a project/component
  'related_to',     // General relationship
  'affects',        // Issue affects a component
  'resolves',       // Task resolves an issue
  'created_by',     // Entity was created by a developer
  'documented_in',  // Component is documented in documentation
  'decided_in',     // Decision was made in a meeting
  'required_by',    // Feature is required by a requirement
  'has_status',     // Entity has a particular status
  'depends_on_milestone', // Task depends on reaching a milestone
  'precedes',       // Task precedes another task (for sequencing)
  'reviews',        // Developer reviews a component
  'tested_in'       // Component is tested in an environment
];

// Status values for different entity types
const STATUS_VALUES = {
  task: ['not_started', 'in_progress', 'blocked', 'complete', 'cancelled'],
  issue: ['open', 'in_progress', 'resolved', 'closed', 'wont_fix'],
  feature: ['planned', 'in_development', 'testing', 'released'],
  milestone: ['planned', 'in_progress', 'reached', 'delayed']
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Collect tool descriptions from text files
const toolDescriptions: Record<string, string> = {
  'startsession': '',
  'loadcontext': '',
  'deletecontext': '',
  'buildcontext': '',
  'advancedcontext': '',
  'endsession': '',
};
for (const tool of Object.keys(toolDescriptions)) {
  try {
    const descriptionFilePath = path.resolve(
      __dirname,
      `developer_${tool}.txt`
    );
    if (existsSync(descriptionFilePath)) {
        toolDescriptions[tool] = readFileSync(descriptionFilePath, 'utf-8');
      }
  } catch (error) {
    console.error(`Error reading description file for tool '${tool}': ${error}`);
  }
}

// Session management functions
async function loadSessionStates(): Promise<Map<string, any[]>> {
  try {
    const fileContent = await fs.readFile(SESSIONS_FILE_PATH, 'utf-8');
    const sessions = JSON.parse(fileContent);
    // Convert from object to Map
    const sessionsMap = new Map<string, any[]>();
    for (const [key, value] of Object.entries(sessions)) {
      sessionsMap.set(key, value as any[]);
    }
    return sessionsMap;
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as any).code === "ENOENT") {
      return new Map<string, any[]>();
    }
    throw error;
  }
}

async function saveSessionStates(sessionsMap: Map<string, any[]>): Promise<void> {
  // Convert from Map to object
  const sessions: Record<string, any[]> = {};
  for (const [key, value] of sessionsMap.entries()) {
    sessions[key] = value;
  }
  await fs.writeFile(SESSIONS_FILE_PATH, JSON.stringify(sessions, null, 2), 'utf-8');
}

// Generate a unique session ID
function generateSessionId(): string {
  return `dev_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

// Basic validation functions
function validateEntityType(entityType: string): boolean {
  return VALID_ENTITY_TYPES.includes(entityType);
}

function validateRelationType(relationType: string): boolean {
  return VALID_RELATION_TYPES.includes(relationType);
}

// We are storing our memory using entities, relations, and observations in a graph structure
interface Entity {
  name: string;
  entityType: string;
  observations: string[];
}

interface Relation {
  from: string;
  to: string;
  relationType: string;
}

interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
}

// The KnowledgeGraphManager class contains all operations to interact with the knowledge graph
class KnowledgeGraphManager {
  private async loadGraph(): Promise<KnowledgeGraph> {
    try {
      const fileContent = await fs.readFile(MEMORY_FILE_PATH, 'utf-8');
      return JSON.parse(fileContent);
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as any).code === "ENOENT") {
        return { entities: [], relations: [] };
      }
      throw error;
    }
  }

  private async saveGraph(graph: KnowledgeGraph): Promise<void> {
    await fs.writeFile(MEMORY_FILE_PATH, JSON.stringify(graph, null, 2), 'utf-8');
  }

  async createEntities(entities: Entity[]): Promise<Entity[]> {
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

  async createRelations(relations: Relation[]): Promise<Relation[]> {
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
    
    const newRelations = relations.filter(r => !graph.relations.some(existingRelation => 
      existingRelation.from === r.from && 
      existingRelation.to === r.to && 
      existingRelation.relationType === r.relationType
    ));
    graph.relations.push(...newRelations);
    await this.saveGraph(graph);
    return newRelations;
  }

  async addObservations(observations: { entityName: string; contents: string[] }[]): Promise<{ entityName: string; addedObservations: string[] }[]> {
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

  async deleteEntities(entityNames: string[]): Promise<void> {
    const graph = await this.loadGraph();
    graph.entities = graph.entities.filter(e => !entityNames.includes(e.name));
    graph.relations = graph.relations.filter(r => !entityNames.includes(r.from) && !entityNames.includes(r.to));
    await this.saveGraph(graph);
  }

  async deleteObservations(deletions: { entityName: string; observations: string[] }[]): Promise<void> {
    const graph = await this.loadGraph();
    deletions.forEach(d => {
      const entity = graph.entities.find(e => e.name === d.entityName);
      if (entity) {
        entity.observations = entity.observations.filter(o => !d.observations.includes(o));
      }
    });
    await this.saveGraph(graph);
  }

  async deleteRelations(relations: Relation[]): Promise<void> {
    const graph = await this.loadGraph();
    graph.relations = graph.relations.filter(r => !relations.some(delRelation => 
      r.from === delRelation.from && 
      r.to === delRelation.to && 
      r.relationType === delRelation.relationType
    ));
    await this.saveGraph(graph);
  }

  async readGraph(): Promise<KnowledgeGraph> {
    return this.loadGraph();
  }

  // Basic search function
  async searchNodes(query: string): Promise<KnowledgeGraph> {
    const graph = await this.loadGraph();
    
    // Filter entities
    const filteredEntities = graph.entities.filter(e => 
      e.name.toLowerCase().includes(query.toLowerCase()) ||
      e.entityType.toLowerCase().includes(query.toLowerCase()) ||
      e.observations.some(o => o.toLowerCase().includes(query.toLowerCase()))
    );
  
    // Create a Set of filtered entity names for quick lookup
    const filteredEntityNames = new Set(filteredEntities.map(e => e.name));
  
    // Filter relations to only include those between filtered entities
    const filteredRelations = graph.relations.filter(r => 
      filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
    );
  
    const filteredGraph: KnowledgeGraph = {
      entities: filteredEntities,
      relations: filteredRelations,
    };
  
    return filteredGraph;
  }

  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    const graph = await this.loadGraph();
    
    // Filter entities
    const filteredEntities = graph.entities.filter(e => names.includes(e.name));
  
    // Create a Set of filtered entity names for quick lookup
    const filteredEntityNames = new Set(filteredEntities.map(e => e.name));
  
    // Filter relations to only include those between filtered entities
    const filteredRelations = graph.relations.filter(r => 
      filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
    );
  
    const filteredGraph: KnowledgeGraph = {
      entities: filteredEntities,
      relations: filteredRelations,
    };
  
    return filteredGraph;
  }

  // Software Development specific functions
  
  // Get project overview including components, features, issues, etc.
  async getProjectStatus(projectName: string): Promise<any> {
    const graph = await this.loadGraph();
    
    // Find the project entity
    const project = graph.entities.find(e => e.name === projectName && e.entityType === 'project');
    if (!project) {
      throw new Error(`Project '${projectName}' not found`);
    }
    
    // Find components that are part of this project
    const components: Entity[] = [];
    
    for (const relation of graph.relations) {
      if (relation.relationType === 'contains' && relation.from === projectName) {
        const component = graph.entities.find(e => e.name === relation.to && e.entityType === 'component');
        if (component) {
          components.push(component);
        }
      }
    }
    
    // Find features, issues, tasks, milestones, and developers related to this project
    const features: Entity[] = [];
    const issues: Entity[] = [];
    const tasks: Entity[] = [];
    const milestones: Entity[] = [];
    const developers: Entity[] = [];
    
    // Find entities directly related to the project
    for (const relation of graph.relations) {
      if (relation.from === projectName || relation.to === projectName) {
        const relatedEntity = graph.entities.find(e => 
          (relation.from === projectName && e.name === relation.to) || 
          (relation.to === projectName && e.name === relation.from)
        );
        
        if (relatedEntity) {
          if (relatedEntity.entityType === 'feature') features.push(relatedEntity);
          if (relatedEntity.entityType === 'issue') issues.push(relatedEntity);
          if (relatedEntity.entityType === 'task') tasks.push(relatedEntity);
          if (relatedEntity.entityType === 'milestone') milestones.push(relatedEntity);
          if (relatedEntity.entityType === 'developer' && relation.relationType === 'works_on') {
            developers.push(relatedEntity);
          }
        }
      }
    }
    
    // Find entities related to components of the project
    for (const component of components) {
      for (const relation of graph.relations) {
        if (relation.from === component.name || relation.to === component.name) {
          const relatedEntity = graph.entities.find(e => 
            (relation.from === component.name && e.name === relation.to) || 
            (relation.to === component.name && e.name === relation.from)
          );
          
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
            if (relatedEntity.entityType === 'developer' && relation.relationType === 'works_on' && 
                !developers.some(d => d.name === relatedEntity.name)) {
              developers.push(relatedEntity);
            }
          }
        }
      }
    }
    
    // Get active tasks and issues
    const activeTasks = tasks.filter(task => {
      const statusObs = task.observations.find(o => o.startsWith('Status:'));
      return statusObs ? !['complete', 'cancelled'].includes(statusObs.split(':')[1].trim().toLowerCase()) : true;
    });
    
    const activeIssues = issues.filter(issue => {
      const statusObs = issue.observations.find(o => o.startsWith('Status:'));
      return statusObs ? !['resolved', 'closed', 'wont_fix'].includes(statusObs.split(':')[1].trim().toLowerCase()) : true;
    });
    
    // Find upcoming milestones
    const upcomingMilestones = milestones.filter(milestone => {
      const statusObs = milestone.observations.find(o => o.startsWith('Status:'));
      return statusObs ? ['planned', 'in_progress'].includes(statusObs.split(':')[1].trim().toLowerCase()) : true;
    });
    
    // Get decision history
    const decisions = graph.entities.filter(e => 
      e.entityType === 'decision' && 
      graph.relations.some(r => 
        (r.from === e.name && r.to === projectName) || 
        (r.to === e.name && r.from === projectName)
      )
    );
    
    return {
      project,
      components,
      activeFeatures: features.filter(f => {
        const statusObs = f.observations.find(o => o.startsWith('Status:'));
        return statusObs ? ['planned', 'in_development', 'testing'].includes(statusObs.split(':')[1].trim().toLowerCase()) : true;
      }),
      activeTasks,
      activeIssues,
      upcomingMilestones,
      developers,
      allFeatures: features,
      allIssues: issues,
      allTasks: tasks,
      allMilestones: milestones,
      recentDecisions: decisions.slice(0, 5)  // Limit to 5 most recent decisions
    };
  }
  
  // Get detailed context for a specific component
  async getComponentContext(componentName: string): Promise<any> {
    const graph = await this.loadGraph();
    
    // Find the component entity
    const component = graph.entities.find(e => e.name === componentName && e.entityType === 'component');
    if (!component) {
      throw new Error(`Component '${componentName}' not found`);
    }
    
    // Find projects this component is part of
    const projects: Entity[] = [];
    
    for (const relation of graph.relations) {
      if (relation.relationType === 'contains' && relation.to === componentName) {
        const project = graph.entities.find(e => e.name === relation.from && e.entityType === 'project');
        if (project) {
          projects.push(project);
        }
      }
    }
    
    // Find features implemented by this component
    const features: Entity[] = [];
    
    for (const relation of graph.relations) {
      if (relation.relationType === 'implements' && relation.from === componentName) {
        const feature = graph.entities.find(e => e.name === relation.to && e.entityType === 'feature');
        if (feature) {
          features.push(feature);
        }
      }
    }
    
    // Find technologies used by this component
    const technologies: Entity[] = [];
    
    for (const relation of graph.relations) {
      if (relation.relationType === 'uses' && relation.from === componentName) {
        const technology = graph.entities.find(e => e.name === relation.to && e.entityType === 'technology');
        if (technology) {
          technologies.push(technology);
        }
      }
    }
    
    // Find developers working on this component
    const developers: Entity[] = [];
    
    for (const relation of graph.relations) {
      if (relation.relationType === 'works_on' && relation.to === componentName) {
        const developer = graph.entities.find(e => e.name === relation.from && e.entityType === 'developer');
        if (developer) {
          developers.push(developer);
        }
      }
    }
    
    // Find issues affecting this component
    const issues: Entity[] = [];
    
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
          graph.entities.some(e => 
            (e.name === relation.from || e.name === relation.to) && 
            e.name !== componentName && 
            e.entityType === 'task'
          )) {
        const task = graph.entities.find(e => 
          (e.name === relation.from || e.name === relation.to) && 
          e.name !== componentName && 
          e.entityType === 'task'
        );
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
    
    return {
      component,
      projects,
      features,
      technologies,
      developers,
      activeIssues: issues.filter(issue => {
        const statusObs = issue.observations.find(o => o.startsWith('Status:'));
        return statusObs ? !['resolved', 'closed', 'wont_fix'].includes(statusObs.split(':')[1].trim().toLowerCase()) : true;
      }),
      activeTasks: tasks.filter(task => {
        const statusObs = task.observations.find(o => o.startsWith('Status:'));
        return statusObs ? !['complete', 'cancelled'].includes(statusObs.split(':')[1].trim().toLowerCase()) : true;
      }),
      documentation,
      dependencies,
      allIssues: issues,
      allTasks: tasks
    };
  }
  
  // Get all entities related to a specific entity
  async getRelatedEntities(entityName: string, relationTypes?: string[]): Promise<any> {
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
      incomingRelations: [] as { relation: Relation; source: Entity }[],
      outgoingRelations: [] as { relation: Relation; target: Entity }[],
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
      } else {
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
  async getDecisionHistory(projectName: string): Promise<any> {
    const graph = await this.loadGraph();
    
    // Find the project
    const project = graph.entities.find(e => e.name === projectName && e.entityType === 'project');
    if (!project) {
      throw new Error(`Project '${projectName}' not found`);
    }
    
    // Find all decision entities related to this project
    const decisions: Entity[] = [];
    
    // Direct decision relations to the project
    for (const relation of graph.relations) {
      if (relation.relationType === 'related_to' && relation.to === projectName) {
        const decision = graph.entities.find(e => e.name === relation.from && e.entityType === 'decision');
        if (decision) {
          decisions.push(decision);
        }
      }
    }
    
    // Decisions related to components of the project
    const components: Entity[] = [];
    
    for (const relation of graph.relations) {
      if (relation.relationType === 'contains' && relation.from === projectName) {
        const component = graph.entities.find(e => e.name === relation.to && e.entityType === 'component');
        if (component) {
          components.push(component);
        }
      }
    }
    
    for (const component of components) {
      for (const relation of graph.relations) {
        if (relation.relationType === 'related_to' && relation.to === component.name) {
          const decision = graph.entities.find(e => e.name === relation.from && e.entityType === 'decision');
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
  async getMilestoneProgress(milestoneName: string): Promise<any> {
    const graph = await this.loadGraph();
    
    // Find the milestone
    const milestone = graph.entities.find(e => e.name === milestoneName && e.entityType === 'milestone');
    if (!milestone) {
      throw new Error(`Milestone '${milestoneName}' not found`);
    }
    
    // Find all tasks related to this milestone
    const tasks: Entity[] = [];
    
    for (const relation of graph.relations) {
      if (relation.relationType === 'related_to' && relation.to === milestoneName) {
        const task = graph.entities.find(e => e.name === relation.from && e.entityType === 'task');
        if (task) {
          tasks.push(task);
        }
      }
    }
    
    // Group tasks by status
    const completedTasks: Entity[] = [];
    const inProgressTasks: Entity[] = [];
    const notStartedTasks: Entity[] = [];
    
    for (const task of tasks) {
      const statusObs = task.observations.find(o => o.startsWith('Status:'));
      const status = statusObs ? statusObs.split(':')[1].trim().toLowerCase() : 'unknown';
      
      if (status === 'completed') {
        completedTasks.push(task);
      } else if (status === 'in progress') {
        inProgressTasks.push(task);
      } else {
        notStartedTasks.push(task);
      }
    }
    
    // Calculate progress percentage
    const totalTasks = tasks.length;
    const progressPercentage = totalTasks > 0 
      ? Math.round((completedTasks.length / totalTasks) * 100) 
      : 0;
    
    // Get deadline if available
    const deadlineObs = milestone.observations.find(o => o.startsWith('Deadline:'));
    const deadline = deadlineObs ? deadlineObs.split(':')[1].trim() : null;
    
    // Check if deadline is approaching
    let deadlineStatus = 'none';
    if (deadline) {
      const deadlineDate = new Date(deadline);
      const today = new Date();
      const daysUntilDeadline = Math.floor((deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysUntilDeadline < 0) {
        deadlineStatus = 'overdue';
      } else if (daysUntilDeadline < 7) {
        deadlineStatus = 'approaching';
      } else {
        deadlineStatus = 'ok';
      }
    }
    
    return {
      milestone,
      progress: {
        totalTasks,
        completedTasks: completedTasks.length,
        inProgressTasks: inProgressTasks.length,
        notStartedTasks: notStartedTasks.length,
        percentage: progressPercentage
      },
      deadline: deadline ? {
        date: deadline,
        status: deadlineStatus
      } : null,
      tasks: {
        completed: completedTasks,
        inProgress: inProgressTasks,
        notStarted: notStartedTasks
      }
    };
  }
}

// Main function to set up the MCP server
async function main() {
  try {
    const knowledgeGraphManager = new KnowledgeGraphManager();
    
    // Initialize session states from persistent storage
    const sessionStates = await loadSessionStates();
    
    // Create the MCP server with a name and version
    const server = new McpServer({
      name: "Context Manager",
      version: "1.0.0"
    });
    
    // Define a resource that exposes the entire graph
    server.resource(
      "graph",
      "graph://developer",
      async (uri) => ({
        contents: [{
          uri: uri.href,
          text: JSON.stringify(await knowledgeGraphManager.readGraph(), null, 2)
        }]
      })
    );
    
    // Define tools using zod for parameter validation
    
    // CRUD operations - these are now consolidated into buildcontext, deletecontext, and advancedcontext tools

    /**
     * Create new entities, relations, and observations.
     */
    server.tool(
      "buildcontext",
      toolDescriptions["buildcontext"],
      {
        type: z.enum(["entities", "relations", "observations"]).describe("Type of creation operation: 'entities', 'relations', or 'observations'"),
        data: z.array(z.any()).describe("Data for the creation operation, structure varies by type but must be an array")
      },
      async ({ type, data }) => {
        try {
          let result;
          
          switch (type) {
            case "entities":
              // Ensure entities match the Entity interface
              const typedEntities: Entity[] = data.map((e: any) => ({
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
              const typedRelations: Relation[] = data.map((r: any) => ({
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
              const typedObservations: { entityName: string; contents: string[] }[] = data.map((o: any) => ({
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
        } catch (error) {
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
      }
    );

    /**
     * Delete entities, relations, and observations.
     */
    server.tool(
      "deletecontext",
      toolDescriptions["deletecontext"],
      {
        type: z.enum(["entities", "relations", "observations"]).describe("Type of deletion operation: 'entities', 'relations', or 'observations'"),
        data: z.array(z.any()).describe("Data for the deletion operation, structure varies by type but must be an array")
      },
      async ({ type, data }) => {
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
              const typedRelations: Relation[] = data.map((r: any) => ({
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
              const typedDeletions: { entityName: string; observations: string[] }[] = data.map((d: any) => ({
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
        } catch (error) {
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
      }
    );

    /**
     * Get information about the graph, search for nodes, open nodes, get related entities, get decision history, and get milestone progress.
     */
    server.tool(
      "advancedcontext",
      toolDescriptions["advancedcontext"],
      {
        type: z.enum(["graph", "search", "nodes", "related", "decisions", "milestone"]).describe("Type of get operation: 'graph', 'search', 'nodes', 'related', 'decisions', or 'milestone'"),
        params: z.record(z.string(), z.any()).describe("Parameters for the operation, structure varies by type")
      },
      async ({ type, params }) => {
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
        } catch (error) {
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
      }
    );

    /**
     * Start a new development session. Returns session ID, recent development sessions, active projects, high-priority tasks, and upcoming milestones.
     * The output allows the user to easily choose what to focus on and which specific context to load.
     */
    server.tool(
      "startsession",
      toolDescriptions["startsession"],
      {},
      async () => {
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
                date: summaryStage?.stageData?.date || "Unknown date",
                project: summaryStage?.stageData?.project || "Unknown project",
                focus: summaryStage?.stageData?.focus || "Unknown focus",
                summary: summaryStage?.stageData?.summary || "No summary available"
              };
            })
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 3); // Default to showing 3 recent sessions
          
          // Get active development projects
          const projectsQuery = await knowledgeGraphManager.searchNodes("entityType:project status:active");
          const projects = projectsQuery.entities;
          
          // Get high-priority development tasks
          const tasksQuery = await knowledgeGraphManager.searchNodes("entityType:task priority:high status:active");
          const highPriorityTasks = tasksQuery.entities;
          
          // Get upcoming milestones
          const milestonesQuery = await knowledgeGraphManager.searchNodes("entityType:milestone status:active");
          const upcomingMilestones = milestonesQuery.entities;
          
          const date = new Date().toISOString().split('T')[0];
          
          let sessionsText = "No recent sessions found.";
          if (recentSessions.length > 0) {
            sessionsText = recentSessions.map(session => 
              `- ${session.date}: ${session.project} - ${session.focus} - ${session.summary.substring(0, 100)}${session.summary.length > 100 ? '...' : ''}`
            ).join('\n');
          }
          
          let projectsText = "No active projects found.";
          if (projects.length > 0) {
            projectsText = projects.map(project => {
              const status = project.observations.find(o => o.startsWith("status:"))?.substring(7) || "Unknown";
              return `- ${project.name} (${status})`;
            }).join('\n');
          }
          
          let tasksText = "No high-priority tasks found.";
          if (highPriorityTasks.length > 0) {
            tasksText = highPriorityTasks.map(task => {
              const status = task.observations.find(o => o.startsWith("status:"))?.substring(7) || "Unknown";
              const assignee = task.observations.find(o => o.startsWith("assignee:"))?.substring(9) || "Unassigned";
              return `- ${task.name} (${status}, Assignee: ${assignee})`;
            }).join('\n');
          }
          
          let milestonesText = "No upcoming milestones found.";
          if (upcomingMilestones.length > 0) {
            milestonesText = upcomingMilestones.map(milestone => {
              const dueDate = milestone.observations.find(o => o.startsWith("due_date:"))?.substring(9) || "No due date";
              return `- ${milestone.name} (Due: ${dueDate})`;
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
        } catch (error) {
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
      }
    );

    /**
     * Load the context for a specific entity.
     * Valid entity types are: project, component, task, issue, milestone, decision, feature, technology, documentation, dependency, developer.
     */
    server.tool(
      "loadcontext",
      toolDescriptions["loadcontext"],
      {
        entityName: z.string(),
        entityType: z.string().optional(),
        sessionId: z.string().optional() // Optional to maintain backward compatibility
      },
      async ({ entityName, entityType = "project", sessionId }) => {
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
          
          // Get the entity
          // Changed from using 'name:' prefix to directly searching by the entity name
          const entityGraph = await knowledgeGraphManager.searchNodes(entityName);
          if (entityGraph.entities.length === 0) {
            throw new Error(`Entity ${entityName} not found`);
          }
          
          // Find the exact entity by name (case-sensitive match)
          const entity = entityGraph.entities.find(e => e.name === entityName);
          if (!entity) {
            throw new Error(`Entity ${entityName} not found`);
          }
          
          // Different context loading based on entity type
          let contextMessage = "";
          
          if (entityType === "project") {
            // Get project status
            const projectStatus = await knowledgeGraphManager.getProjectStatus(entityName);
            
            // Format project context
            const status = entity.observations.find(o => o.startsWith("Status:"))?.substring(7) || "Unknown";
            const updated = entity.observations.find(o => o.startsWith("updated:"))?.substring(8) || "Unknown";
            const description = entity.observations.find(o => !o.startsWith("Status:") && !o.startsWith("updated:"));
            
            const componentsText = projectStatus.components?.map((component: Entity) => {
              const desc = component.observations.find(o => !o.startsWith("Status:"));
              return `- **${component.name}**: ${desc || "No description"}`;
            }).join("\n") || "No components found";
            
            const featuresText = projectStatus.activeFeatures?.map((feature: Entity) => {
              const statusObs = feature.observations.find(o => o.startsWith("Status:"))?.substring(7) || "unknown";
              const desc = feature.observations.find(o => !o.startsWith("Status:"));
              return `- **${feature.name}** (${statusObs}): ${desc || "No description"}`;
            }).join("\n") || "No active features found";
            
            const tasksText = projectStatus.activeTasks?.map((task: Entity) => {
              const statusObs = task.observations.find(o => o.startsWith("Status:"))?.substring(7) || "unknown";
              const desc = task.observations.find(o => !o.startsWith("Status:") && !o.startsWith("priority:"));
              const priority = task.observations.find(o => o.startsWith("priority:"))?.substring(9) || "medium";
              return `- **${task.name}** (${statusObs}, ${priority} priority): ${desc || "No description"}`;
            }).join("\n") || "No active tasks found";
            
            const issuesText = projectStatus.activeIssues?.map((issue: Entity) => {
              const statusObs = issue.observations.find(o => o.startsWith("Status:"))?.substring(7) || "unknown";
              const desc = issue.observations.find(o => !o.startsWith("Status:"));
              return `- **${issue.name}** (${statusObs}): ${desc || "No description"}`;
            }).join("\n") || "No active issues found";
            
            const milestonesText = projectStatus.upcomingMilestones?.map((milestone: Entity) => {
              const statusObs = milestone.observations.find(o => o.startsWith("Status:"))?.substring(7) || "unknown";
              const deadline = milestone.observations.find(o => o.startsWith("Deadline:"))?.substring(9) || "No deadline";
              const desc = milestone.observations.find(o => !o.startsWith("Status:") && !o.startsWith("Deadline:"));
              return `- **${milestone.name}** (${statusObs}, due: ${deadline}): ${desc || "No description"}`;
            }).join("\n") || "No upcoming milestones found";
            
            const developersText = projectStatus.developers?.map((developer: Entity) => {
              const role = developer.observations.find(o => o.startsWith("role:"))?.substring(5) || "Unknown role";
              return `- **${developer.name}** (${role})`;
            }).join("\n") || "No developers assigned";
            
            const decisionsText = projectStatus.recentDecisions?.map((decision: Entity) => {
              const date = decision.observations.find(o => o.startsWith("Date:"))?.substring(5) || "Unknown date";
              const desc = decision.observations.find(o => !o.startsWith("Date:"));
              return `- **${decision.name}** (${date}): ${desc || "No description"}`;
            }).join("\n") || "No recent decisions";
            
            contextMessage = `# Software Development Project Context: ${entityName}

## Project Overview
- **Status**: ${status}
- **Last Updated**: ${updated}
- **Description**: ${description || "No description"}

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

## Team Members
${developersText}

## Recent Decisions
${decisionsText}`;
          } 
          else if (entityType === "component") {
            // Get component context
            const componentContext = await knowledgeGraphManager.getComponentContext(entityName);
            
            // Format component context message
            const description = entity.observations.find(o => !o.startsWith("Status:"));
            
            const projectsText = componentContext.projects?.map((project: Entity) => {
              return `- **${project.name}**`;
            }).join("\n") || "No parent projects found";
            
            const featuresText = componentContext.features?.map((feature: Entity) => {
              const statusObs = feature.observations.find(o => o.startsWith("Status:"))?.substring(7) || "unknown";
              const desc = feature.observations.find(o => !o.startsWith("Status:"));
              return `- **${feature.name}** (${statusObs}): ${desc || "No description"}`;
            }).join("\n") || "No implemented features found";
            
            const technologiesText = componentContext.technologies?.map((tech: Entity) => {
              const desc = tech.observations.find(o => !o.startsWith("version:"));
              const version = tech.observations.find(o => o.startsWith("version:"))?.substring(8) || "unknown version";
              return `- **${tech.name}** (${version}): ${desc || "No description"}`;
            }).join("\n") || "No technologies specified";
            
            const issuesText = componentContext.activeIssues?.map((issue: Entity) => {
              const statusObs = issue.observations.find(o => o.startsWith("Status:"))?.substring(7) || "unknown";
              const desc = issue.observations.find(o => !o.startsWith("Status:"));
              return `- **${issue.name}** (${statusObs}): ${desc || "No description"}`;
            }).join("\n") || "No active issues found";
            
            const developersText = componentContext.developers?.map((developer: Entity) => {
              const role = developer.observations.find(o => o.startsWith("role:"))?.substring(5) || "Unknown role";
              return `- **${developer.name}** (${role})`;
            }).join("\n") || "No developers assigned";
            
            const dependenciesText = componentContext.dependencies?.map((dep: Entity) => {
              return `- **${dep.name}** (${dep.entityType})`;
            }).join("\n") || "No dependencies found";
            
            const documentationText = componentContext.documentation?.map((doc: Entity) => {
              const updated = doc.observations.find(o => o.startsWith("updated:"))?.substring(8) || "Unknown";
              const desc = doc.observations.find(o => !o.startsWith("updated:"));
              return `- **${doc.name}** (Updated: ${updated}): ${desc || "No description"}`;
            }).join("\n") || "No documentation found";
            
            contextMessage = `# Component Context: ${entityName}

## Overview
- **Description**: ${description || "No description"}
- **Part of Projects**: ${projectsText}

## Technologies
${technologiesText}

## Implemented Features
${featuresText}

## Dependencies
${dependenciesText}

## Active Issues
${issuesText}

## Documentation
${documentationText}

## Team Members
${developersText}`;
          }
          else if (entityType === "feature") {
            // Get related entities
            const relatedEntities = await knowledgeGraphManager.getRelatedEntities(entityName);
            
            // Format feature context message
            const statusObs = entity.observations.find(o => o.startsWith("Status:"))?.substring(7) || "unknown";
            const description = entity.observations.find(o => !o.startsWith("Status:") && !o.startsWith("priority:"));
            const priority = entity.observations.find(o => o.startsWith("priority:"))?.substring(9) || "medium";
            
            // Find implementing components
            const implementingComponents = relatedEntities.incomingRelations
              .filter((rel: { relation: Relation; source: Entity }) => rel.relation.relationType === "implements")
              .map((rel: { relation: Relation; source: Entity }) => rel.source);
            
            const componentsText = implementingComponents.map((component: Entity) => {
              return `- **${component.name}**`;
            }).join("\n") || "No implementing components found";
            
            // Find related tasks
            const relatedTasks = [...relatedEntities.incomingRelations, ...relatedEntities.outgoingRelations]
              .filter((rel: { relation: Relation; source?: Entity; target?: Entity }) => 
                rel.relation.relationType === "related_to" && 
                (rel.source?.entityType === "task" || rel.target?.entityType === "task")
              )
              .map((rel: { relation: Relation; source?: Entity; target?: Entity }) => 
                rel.source?.entityType === "task" ? rel.source : rel.target
              )
              .filter((entity): entity is Entity => entity !== undefined);
            
            const tasksText = relatedTasks.map((task: Entity) => {
              const statusObs = task.observations.find(o => o.startsWith("Status:"))?.substring(7) || "unknown";
              const desc = task.observations.find(o => !o.startsWith("Status:") && !o.startsWith("priority:"));
              return `- **${task.name}** (${statusObs}): ${desc || "No description"}`;
            }).join("\n") || "No related tasks found";
            
            // Find requirements
            const requirements = relatedEntities.incomingRelations
              .filter((rel: { relation: Relation; source: Entity }) => rel.relation.relationType === "required_by")
              .map((rel: { relation: Relation; source: Entity }) => rel.source);
            
            const requirementsText = requirements.map((req: Entity) => {
              const desc = req.observations.find(o => !o.startsWith("priority:"));
              return `- **${req.name}**: ${desc || "No description"}`;
            }).join("\n") || "No requirements specified";
            
            contextMessage = `# Feature Context: ${entityName}

## Overview
- **Status**: ${statusObs}
- **Priority**: ${priority}
- **Description**: ${description || "No description"}

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
            
            // Format task context message
            const statusObs = entity.observations.find(o => o.startsWith("Status:"))?.substring(7) || "unknown";
            const description = entity.observations.find(o => !o.startsWith("Status:") && !o.startsWith("priority:") && !o.startsWith("due:"));
            const priority = entity.observations.find(o => o.startsWith("priority:"))?.substring(9) || "medium";
            const due = entity.observations.find(o => o.startsWith("due:"))?.substring(4) || "No deadline";
            
            // Find related issues
            const relatedIssues = relatedEntities.outgoingRelations
              .filter((rel: { relation: Relation; target: Entity }) => rel.relation.relationType === "resolves")
              .map((rel: { relation: Relation; target: Entity }) => rel.target);
            
            const issuesText = relatedIssues.map((issue: Entity) => {
              const statusObs = issue.observations.find(o => o.startsWith("Status:"))?.substring(7) || "unknown";
              const desc = issue.observations.find(o => !o.startsWith("Status:"));
              return `- **${issue.name}** (${statusObs}): ${desc || "No description"}`;
            }).join("\n") || "No related issues found";
            
            // Find assigned developer
            const assignedDevelopers = relatedEntities.incomingRelations
              .filter((rel: { relation: Relation; source: Entity }) => rel.relation.relationType === "assigned_to")
              .map((rel: { relation: Relation; source: Entity }) => rel.source);
            
            const assigneesText = assignedDevelopers.map((dev: Entity) => {
              const role = dev.observations.find(o => o.startsWith("role:"))?.substring(5) || "Unknown role";
              return `- **${dev.name}** (${role})`;
            }).join("\n") || "No developers assigned";
            
            // Find parent project
            const parentProjects = relatedEntities.incomingRelations
              .filter((rel: { relation: Relation; source: Entity }) => rel.relation.relationType === "contains" && rel.source.entityType === "project")
              .map((rel: { relation: Relation; source: Entity }) => rel.source);
            
            const projectName = parentProjects.length > 0 ? parentProjects[0].name : "Unknown project";
            
            // Find blocking tasks or issues
            const blockingItems = relatedEntities.outgoingRelations
              .filter((rel: { relation: Relation; target: Entity }) => rel.relation.relationType === "blocked_by")
              .map((rel: { relation: Relation; target: Entity }) => rel.target);
            
            const blockingText = blockingItems.map((item: Entity) => {
              const statusObs = item.observations.find(o => o.startsWith("Status:"))?.substring(7) || "unknown";
              return `- **${item.name}** (${item.entityType}, ${statusObs})`;
            }).join("\n") || "No blocking items";
            
            contextMessage = `# Task Context: ${entityName}

## Overview
- **Project**: ${projectName}
- **Status**: ${statusObs}
- **Priority**: ${priority}
- **Due Date**: ${due}
- **Description**: ${description || "No description"}

## Assigned To
${assigneesText}

## Related Issues
${issuesText}

## Blocked By
${blockingText}`;
          }
          else if (entityType === "milestone") {
            // Get milestone progress
            const milestoneProgress = await knowledgeGraphManager.getMilestoneProgress(entityName);
            
            // Format milestone context message
            const statusObs = entity.observations.find(o => o.startsWith("Status:"))?.substring(7) || "unknown";
            const description = entity.observations.find(o => !o.startsWith("Status:") && !o.startsWith("Deadline:"));
            const deadline = entity.observations.find(o => o.startsWith("Deadline:"))?.substring(9) || "No deadline";
            
            contextMessage = `# Milestone Context: ${entityName}

## Overview
- **Status**: ${statusObs}
- **Deadline**: ${deadline}
- **Description**: ${description || "No description"}
- **Progress**: ${milestoneProgress.progress?.percentage || 0}% complete

## Deadline Status
${milestoneProgress.deadline?.status === "overdue" ? "⚠️ **OVERDUE**" : 
  milestoneProgress.deadline?.status === "approaching" ? "⚠️ **DEADLINE APPROACHING**" : 
  "✅ On track"}

## Tasks
### Completed (${milestoneProgress.tasks?.completed?.length || 0})
${milestoneProgress.tasks?.completed?.map((task: Entity) => {
  const desc = task.observations.find(o => !o.startsWith("Status:") && !o.startsWith("priority:"));
  return `- **${task.name}**: ${desc || "No description"}`;
}).join("\n") || "No completed tasks"}

### In Progress (${milestoneProgress.tasks?.inProgress?.length || 0})
${milestoneProgress.tasks?.inProgress?.map((task: Entity) => {
  const desc = task.observations.find(o => !o.startsWith("Status:") && !o.startsWith("priority:"));
  return `- **${task.name}**: ${desc || "No description"}`;
}).join("\n") || "No in-progress tasks"}

### Not Started (${milestoneProgress.tasks?.notStarted?.length || 0})
${milestoneProgress.tasks?.notStarted?.map((task: Entity) => {
  const desc = task.observations.find(o => !o.startsWith("Status:") && !o.startsWith("priority:"));
  return `- **${task.name}**: ${desc || "No description"}`;
}).join("\n") || "No not-started tasks"}`;
          }
          else {
            // Generic entity context for other entity types
            const relatedEntities = await knowledgeGraphManager.getRelatedEntities(entityName);
            
            // Build a text representation of related entities
            const incomingText = relatedEntities.incomingRelations.map((rel: { relation: Relation; source: Entity }) => {
              return `- **${rel.source.name}** (${rel.source.entityType}) → ${rel.relation.relationType} → ${entityName}`;
            }).join("\n") || "No incoming relations";
            
            const outgoingText = relatedEntities.outgoingRelations.map((rel: { relation: Relation; target: Entity }) => {
              return `- **${entityName}** → ${rel.relation.relationType} → **${rel.target.name}** (${rel.target.entityType})`;
            }).join("\n") || "No outgoing relations";
            
            // Format observations
            const observationsText = entity.observations.map(obs => `- ${obs}`).join("\n") || "No observations";
            
            contextMessage = `# Entity Context: ${entityName} (${entityType})

## Observations
${observationsText}

## Incoming Relations
${incomingText}

## Outgoing Relations
${outgoingText}`;
          }
          
          return {
            content: [{
              type: "text",
              text: contextMessage
            }]
          };
        } catch (error) {
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
      }
    );

    // Helper function to process each stage of endsession
    async function processStage(params: {
      sessionId: string;
      stage: string;
      stageNumber: number;
      totalStages: number;
      analysis?: string;
      stageData?: any;
      nextStageNeeded: boolean;
      isRevision?: boolean;
      revisesStage?: number;
    }, previousStages: any[]): Promise<any> {
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
    function assembleEndSessionArgs(stages: any[]): any {
      const summaryStage = stages.find(s => s.stage === "summary");
      const achievementsStage = stages.find(s => s.stage === "achievements");
      const taskUpdatesStage = stages.find(s => s.stage === "taskUpdates");
      const newTasksStage = stages.find(s => s.stage === "newTasks");
      const projectStatusStage = stages.find(s => s.stage === "projectStatus");
      
      // Get current date
      const date = new Date().toISOString().split('T')[0];
      
      return {
        date,
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
    server.tool(
      "endsession",
      toolDescriptions["endsession"],
      {
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
      },
      async (params) => {
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
            } else {
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
          } else {
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
              const date = args.date;
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
              const achievementEntities = achievements.map((achievement: string, i: number) => ({
                name: `Achievement_${date.replace(/-/g, "")}_${i + 1}`,
                entityType: "decision",
                observations: [achievement]
              }));
              
              if (achievementEntities.length > 0) {
                await knowledgeGraphManager.createEntities(achievementEntities);
                
                // Link achievements to focus project
                const achievementRelations = achievementEntities.map((achievement: {name: string}) => ({
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
                  const observations = taskEntity.observations.filter(o => !o.startsWith("status:"));
                  observations.push(`status:${task.status}`);
                  
                  await knowledgeGraphManager.deleteEntities([task.name]);
                  await knowledgeGraphManager.createEntities([{
                    name: task.name,
                    entityType: "task",
                    observations
                  }]);
                  
                  // If completed, link to this session
                  if (task.status === "complete") {
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
                let observations = projectEntity.observations.filter(o => !o.startsWith("status:") && !o.startsWith("updated:"));
                observations.push(`status:${projectUpdate.status}`);
                observations.push(`updated:${date}`);
                
                if (projectUpdate.observation) {
                  observations.push(projectUpdate.observation);
                }
                
                await knowledgeGraphManager.deleteEntities([projectUpdate.name]);
                await knowledgeGraphManager.createEntities([{
                  name: projectUpdate.name,
                  entityType: "project",
                  observations
                }]);
              }
              
              // 5. Create new tasks
              if (newTasks && newTasks.length > 0) {
                const taskEntities = newTasks.map((task: {name: string, description: string, priority?: string}, i: number) => ({
                  name: task.name,
                  entityType: "task",
                  observations: [
                    task.description,
                    `status:not_started`,
                    `priority:${task.priority || "medium"}`
                  ]
                }));
                
                await knowledgeGraphManager.createEntities(taskEntities);
                
                // Link tasks to project
                const taskRelations = taskEntities.map((task: {name: string}) => ({
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
                date: date,
                summary: summary,
                project: focus
              });
              
              sessionStates.set(params.sessionId, sessionState);
              await saveSessionStates(sessionStates);
              
              // Prepare the summary message
              const summaryMessage = `# Development Session Recorded

I've recorded your development session from ${date} focusing on ${focus}.

## Achievements Documented
${achievements.map((a: string) => `- ${a}`).join('\n') || "No achievements recorded."}

## Task Updates
${taskUpdates.map((t: {name: string, status: string}) => `- ${t.name}: ${t.status}`).join('\n') || "No task updates."}

## Project Status
Project ${projectUpdate.name} has been updated to: ${projectUpdate.status}

${newTasks && newTasks.length > 0 ? `## New Tasks Added
${newTasks.map((t: {name: string, description: string, priority?: string}) => `- ${t.name}: ${t.description} (Priority: ${t.priority || "medium"})`).join('\n')}` : "No new tasks added."}

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
            } catch (error) {
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
          } else {
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
        } catch (error) {
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
      }
    );

    // Connect the server to the transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
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