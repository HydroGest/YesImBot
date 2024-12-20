import { SchemaNode } from "../adapters/creators/schema";
import { Extension } from "./base";

class InsertArchivalMemory extends Extension {
  name = "insertArchivalMemory";
  description = "Add to archival memory. Make sure to phrase the memory contents such that it can be easily queried later.";
  params = {
    content: SchemaNode.String("Content to write to the memory. All unicode (including emojis) are supported."),
  };

  async apply(content: string) {
    return ""
  }
}

export const insertArchivalMemory = new InsertArchivalMemory();

class SearchArchivalMemory extends Extension {
  name = "searchArchivalMemory";
  description = "Search archival memory using semantic (embedding-based) search.";
  params = {
    query: SchemaNode.String("String to search for."),
    page: SchemaNode.Integer("Allows you to page through results. Only use on a follow-up query. Defaults to 0 (first page).", 0),
    start: SchemaNode.Integer("Starting index for the search results. Defaults to 0.", 0),
  };

  async apply(query: string, page: number = 0, start: number = 0) {
    return ""
  }
}

export const searchArchivalMemory = new SearchArchivalMemory();

class AppendCoreMemory extends Extension {
  name = "appendCoreMemory";
  description = "Append to the contents of core memory.";
  params = {
    label: SchemaNode.String("Section of the memory to be edited (persona or human)."),
    content: SchemaNode.String("Content to write to the memory. All unicode (including emojis) are supported."),
  };

  async apply(label: string, content: string) {
    return ""
  }
}

export const appendCoreMemory = new AppendCoreMemory();

class ModifyCoreMemory extends Extension {
  name = "modifyCoreMemory";
  description = "Replace the contents of core memory. To delete memories, use an empty string for newContent.";
  params = {
    label: SchemaNode.String("Section of the memory to be edited (persona or human)."),
    oldContent: SchemaNode.String("The current content of the memory."),
    newContent: SchemaNode.String("The new content of the memory. All unicode (including emojis) are supported."),
  };

  async apply(label: string, oldContent: string, newContent: string) {
    return ""
  }
}

export const modifyCoreMemory = new ModifyCoreMemory();

class SearchConversation extends Extension {
  name = "searchConversation";
  description = "Search conversation using semantic (embedding-based) search.";
  params = {
    query: SchemaNode.String("String to search for."),
    page: SchemaNode.Integer("Allows you to page through results. Only use on a follow-up query. Defaults to 0 (first page).", 0),
    start: SchemaNode.Integer("Starting index for the search results. Defaults to 0.", 0),
  };

  async apply(query: string, page: number = 0, start: number = 0) {
    return ""
  }
}

export const searchConversation = new SearchConversation();
