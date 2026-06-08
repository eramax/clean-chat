export interface Server {
  name: string;
  baseUrl: string;
  apiKey: string;
  model?: string;
}

export type MessageRole = 'user' | 'assistant' | 'tool';

export type AttachmentKind = 'pdf-md' | 'image' | 'text' | 'file';

export interface Attachment {
  name: string;
  mime: string;
  kind: AttachmentKind;
  data: string;
  size: number;
}

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
  source: string;
}

export interface UserMessage {
  role: 'user';
  content: string;
  attachments?: Attachment[];
}

export interface AssistantMessage {
  role: 'assistant';
  content: string;
  reasoning?: string;
  status: 'running' | 'complete' | 'cancelled';
  timing?: string;
}

export interface SearchToolMessage {
  role: 'tool';
  tool: 'web_search';
  query: string;
  status: 'running' | 'complete';
  results: SearchResult[];
  showAll?: boolean;
}

export interface GenericToolMessage {
  role: 'tool';
  tool: string;
  label: string;
  input: string;
  status: 'running' | 'complete';
  result: string;
  showAll?: boolean;
}

export type Message = UserMessage | AssistantMessage | SearchToolMessage | GenericToolMessage;

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface SelectedModel {
  serverIdx: number;
  model: string;
}

export type Theme = 'dark' | 'light';
