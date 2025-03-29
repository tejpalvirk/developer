#!/usr/bin/env node
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
declare class KnowledgeGraphManager {
    private loadGraph;
    private saveGraph;
    initializeStatusAndPriority(): Promise<void>;
    getEntityStatus(entityName: string): Promise<string | null>;
    getEntityPriority(entityName: string): Promise<string | null>;
    setEntityStatus(entityName: string, statusValue: string): Promise<void>;
    setEntityPriority(entityName: string, priorityValue: string): Promise<void>;
    createEntities(entities: Entity[]): Promise<Entity[]>;
    createRelations(relations: Relation[]): Promise<Relation[]>;
    addObservations(observations: {
        entityName: string;
        contents: string[];
    }[]): Promise<{
        entityName: string;
        addedObservations: string[];
    }[]>;
    deleteEntities(entityNames: string[]): Promise<void>;
    deleteObservations(deletions: {
        entityName: string;
        observations: string[];
    }[]): Promise<void>;
    deleteRelations(relations: Relation[]): Promise<void>;
    readGraph(): Promise<KnowledgeGraph>;
    searchNodes(query: string): Promise<KnowledgeGraph>;
    openNodes(names: string[]): Promise<KnowledgeGraph>;
    getProjectStatus(projectName: string): Promise<any>;
    getComponentContext(componentName: string): Promise<any>;
    getRelatedEntities(entityName: string, relationTypes?: string[]): Promise<any>;
    getDecisionHistory(projectName: string): Promise<any>;
    getMilestoneProgress(milestoneName: string): Promise<any>;
}
export { KnowledgeGraphManager };
