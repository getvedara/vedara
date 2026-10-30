/**
 * Ambient type definitions for the Visual Studio Code Extension API.
 * Provides 100% offline, self-contained typings for compilation without external npm downloads.
 */

declare module 'vscode' {
  export class Position {
    readonly line: number;
    readonly character: number;
    constructor(line: number, character: number);
    isEqual(other: Position): boolean;
    compareTo(other: Position): number;
    translate(lineDelta?: number, characterDelta?: number): Position;
    with(line?: number, character?: number): Position;
  }

  export class Range {
    readonly start: Position;
    readonly end: Position;
    constructor(start: Position, end: Position);
    constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);
    readonly isEmpty: boolean;
    readonly isSingleLine: boolean;
    contains(positionOrRange: Position | Range): boolean;
    isEqual(other: Range): boolean;
  }

  export interface Disposable {
    dispose(): any;
  }

  export interface CancellationToken {
    readonly isCancellationRequested: boolean;
    onCancellationRequested(listener: (e: any) => any, thisArgs?: any, disposables?: Disposable[]): Disposable;
  }

  export interface TextLine {
    readonly lineNumber: number;
    readonly text: string;
    readonly range: Range;
    readonly rangeIncludingLineBreak: Range;
    readonly firstNonWhitespaceCharacterIndex: number;
    readonly isEmptyOrWhitespace: boolean;
  }

  export class Uri {
    readonly scheme: string;
    readonly authority: string;
    readonly path: string;
    readonly query: string;
    readonly fragment: string;
    readonly fsPath: string;
    constructor(scheme: string, authority: string, path: string, query: string, fragment: string);
    static file(path: string): Uri;
    static parse(value: string, _strict?: boolean): Uri;
    toString(skipEncoding?: boolean): string;
  }

  export type Event<T> = (listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]) => Disposable;

  export class EventEmitter<T> {
    readonly event: Event<T>;
    fire(data: T): void;
    dispose(): void;
  }

  export interface WorkspaceFolder {
    readonly uri: Uri;
    readonly name: string;
    readonly index: number;
  }

  export class TextEdit {
    range: Range;
    newText: string;
    constructor(range: Range, newText: string);
    static replace(range: Range, newText: string): TextEdit;
    static insert(position: Position, newText: string): TextEdit;
    static delete(range: Range): TextEdit;
  }

  export class WorkspaceEdit {
    replace(uri: Uri, range: Range, newText: string): void;
    insert(uri: Uri, position: Position, newText: string): void;
    delete(uri: Uri, range: Range): void;
  }

  export interface TextDocumentContentProvider {
    onDidChange?: Event<Uri>;
    provideTextDocumentContent(uri: Uri, token: CancellationToken): ProviderResult<string>;
  }

  export interface TextDocument {
    readonly uri: Uri;
    readonly fileName: string;
    readonly isUntitled: boolean;
    readonly languageId: string;
    readonly version: number;
    readonly isDirty: boolean;
    readonly lineCount: number;
    lineAt(line: number): TextLine;
    lineAt(position: Position): TextLine;
    offsetAt(position: Position): number;
    positionAt(offset: number): Position;
    getText(range?: Range): string;
    save(): Thenable<boolean>;
  }

  export interface TextEditorEdit {
    replace(location: Position | Range, value: string): void;
    insert(location: Position, value: string): void;
    delete(location: Range): void;
  }

  export interface Selection extends Range {
    readonly anchor: Position;
    readonly active: Position;
    readonly isReversed: boolean;
  }

  export interface TextEditor {
    readonly document: TextDocument;
    selection: Selection;
    selections: Selection[];
    edit(callback: (editBuilder: TextEditorEdit) => void, options?: { undoStopBefore: boolean; undoStopAfter: boolean }): Thenable<boolean>;
    setDecorations(decorationType: TextEditorDecorationType, rangesOrOptions: readonly Range[] | readonly DecorationOptions[]): void;
  }

  export enum InlineCompletionTriggerKind {
    Invoke = 0,
    Automatic = 1,
  }

  export interface InlineCompletionContext {
    readonly triggerKind: InlineCompletionTriggerKind;
    readonly selectedCompletionInfo?: {
      readonly range: Range;
      readonly text: string;
    };
  }

  export class InlineCompletionItem {
    insertText: string;
    range?: Range;
    filterText?: string;
    command?: Command;
    constructor(insertText: string, range?: Range);
  }

  export class InlineCompletionList {
    items: InlineCompletionItem[];
    constructor(items: InlineCompletionItem[]);
  }

  export type ProviderResult<T> = T | undefined | null | Thenable<T | undefined | null>;

  export interface InlineCompletionItemProvider {
    provideInlineCompletionItems(
      document: TextDocument,
      position: Position,
      context: InlineCompletionContext,
      token: CancellationToken
    ): ProviderResult<InlineCompletionItem[] | InlineCompletionList>;
  }

  export enum StatusBarAlignment {
    Left = 1,
    Right = 2,
  }

  export interface StatusBarItem extends Disposable {
    readonly alignment: StatusBarAlignment;
    readonly priority?: number;
    text: string;
    tooltip?: string;
    color?: string;
    backgroundColor?: any;
    command?: string;
    show(): void;
    hide(): void;
  }

  export interface WorkspaceConfiguration {
    get<T>(section: string): T | undefined;
    get<T>(section: string, defaultValue: T): T;
    has(section: string): boolean;
    update(section: string, value: any, configurationTarget?: boolean | any): Thenable<void>;
  }

  export interface Command {
    title: string;
    command: string;
    tooltip?: string;
    arguments?: any[];
  }

  export interface Memento {
    keys(): readonly string[];
    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    update(key: string, value: any): Thenable<void>;
  }

  export enum ConfigurationTarget {
    Global = 1,
    Workspace = 2,
    WorkspaceFolder = 3,
  }

  export interface TextDocumentContentChangeEvent {
    readonly range: Range;
    readonly rangeOffset: number;
    readonly rangeLength: number;
    readonly text: string;
  }

  export interface TextDocumentChangeEvent {
    readonly document: TextDocument;
    readonly contentChanges: readonly TextDocumentContentChangeEvent[];
    readonly reason?: 1 | 2;
  }

  export interface TextEditorSelectionChangeEvent {
    readonly textEditor: TextEditor;
    readonly selections: readonly Selection[];
  }

  export class ThemeColor {
    constructor(id: string);
  }

  export interface ThemableDecorationAttachmentRenderOptions {
    contentText?: string;
    color?: string | ThemeColor;
    backgroundColor?: string | ThemeColor;
    fontStyle?: string;
    margin?: string;
    border?: string;
  }

  export interface DecorationRenderOptions {
    backgroundColor?: string | ThemeColor;
    border?: string;
    borderColor?: string | ThemeColor;
    textDecoration?: string;
    opacity?: string;
    isWholeLine?: boolean;
    after?: ThemableDecorationAttachmentRenderOptions;
    before?: ThemableDecorationAttachmentRenderOptions;
  }

  export interface TextEditorDecorationType extends Disposable {
    readonly key: string;
  }

  export interface DecorationOptions {
    range: Range;
    hoverMessage?: string;
    renderOptions?: { after?: ThemableDecorationAttachmentRenderOptions; before?: ThemableDecorationAttachmentRenderOptions };
  }

  export interface QuickPickItem {
    label: string;
    description?: string;
    detail?: string;
    picked?: boolean;
  }

  export interface QuickPickOptions {
    title?: string;
    placeHolder?: string;
    matchOnDescription?: boolean;
    matchOnDetail?: boolean;
    canPickMany?: false;
  }

  export interface MessageOptions {
    modal?: boolean;
    detail?: string;
  }

  export enum ProgressLocation {
    SourceControl = 1,
    Window = 10,
    Notification = 15,
  }

  export interface Progress<T> {
    report(value: T): void;
  }

  export interface Extension<T> {
    readonly id: string;
    readonly extensionPath: string;
    readonly isActive: boolean;
    readonly exports: T;
    activate(): Thenable<T>;
  }

  export namespace extensions {
    export function getExtension<T = any>(extensionId: string): Extension<T> | undefined;
  }

  export interface SecretStorage {
    get(key: string): Thenable<string | undefined>;
    store(key: string, value: string): Thenable<void>;
    delete(key: string): Thenable<void>;
  }

  export interface InputBoxOptions {
    title?: string;
    prompt?: string;
    placeHolder?: string;
    password?: boolean;
    ignoreFocusOut?: boolean;
  }

  export interface ExtensionContext {
    readonly secrets: SecretStorage;
    readonly globalState: Memento;
    readonly subscriptions: Disposable[];
    readonly extensionUri: any;
    readonly extensionPath: string;
  }

  export namespace languages {
    export function registerInlineCompletionItemProvider(
      selector: any,
      provider: InlineCompletionItemProvider
    ): Disposable;
  }

  export namespace commands {
    export function registerCommand(command: string, callback: (...args: any[]) => any, thisArg?: any): Disposable;
    export function executeCommand<T = unknown>(command: string, ...rest: any[]): Thenable<T>;
  }

  export enum ViewColumn {
    Active = -1,
    Beside = -2,
    One = 1,
    Two = 2,
    Three = 3,
    Four = 4,
    Five = 5,
    Six = 6,
    Seven = 7,
    Eight = 8,
    Nine = 9,
  }

  export interface WebviewOptions {
    readonly enableScripts?: boolean;
    readonly enableForms?: boolean;
    readonly localResourceRoots?: readonly Uri[];
    readonly portMapping?: readonly any[];
  }

  export interface Webview {
    options: WebviewOptions;
    html: string;
    readonly onDidReceiveMessage: Event<any>;
    postMessage(message: any): Thenable<boolean>;
    asWebviewUri(localResource: Uri): Uri;
    readonly cspSource: string;
  }

  export interface WebviewViewResolveContext<T = unknown> {
    readonly state?: T;
  }

  export interface WebviewView {
    readonly viewType: string;
    readonly webview: Webview;
    title?: string;
    description?: string;
    badge?: any;
    readonly visible: boolean;
    readonly onDidChangeVisibility: Event<void>;
    readonly onDidDispose: Event<void>;
    show?(preserveFocus?: boolean): void;
  }

  export interface WebviewViewProvider {
    resolveWebviewView(
      webviewView: WebviewView,
      context: WebviewViewResolveContext,
      token: CancellationToken
    ): Thenable<void> | void;
  }

  export namespace window {
    export const activeTextEditor: TextEditor | undefined;
    export function showInformationMessage(message: string, ...items: string[]): Thenable<string | undefined>;
    export function showWarningMessage(message: string, ...items: string[]): Thenable<string | undefined>;
    export function showErrorMessage(message: string, ...items: string[]): Thenable<string | undefined>;
    export function showInformationMessage(message: string, options: MessageOptions, ...items: string[]): Thenable<string | undefined>;
    export function showWarningMessage(message: string, options: MessageOptions, ...items: string[]): Thenable<string | undefined>;
    export function showInputBox(options?: InputBoxOptions, token?: CancellationToken): Thenable<string | undefined>;
    export function showQuickPick<T extends QuickPickItem>(
      items: readonly T[] | Thenable<readonly T[]>,
      options?: QuickPickOptions,
      token?: CancellationToken
    ): Thenable<T | undefined>;
    export function withProgress<R>(
      options: { location: ProgressLocation; title?: string; cancellable?: boolean },
      task: (progress: Progress<{ message?: string; increment?: number }>, token: CancellationToken) => Thenable<R>
    ): Thenable<R>;
    export function createTextEditorDecorationType(options: DecorationRenderOptions): TextEditorDecorationType;
    export const visibleTextEditors: readonly TextEditor[];
    export const onDidChangeActiveTextEditor: Event<TextEditor | undefined>;
    export const onDidChangeTextEditorSelection: Event<TextEditorSelectionChangeEvent>;
    export function createStatusBarItem(alignment?: StatusBarAlignment, priority?: number): StatusBarItem;
    export function registerWebviewViewProvider(
      viewId: string,
      provider: WebviewViewProvider,
      options?: { readonly webviewOptions?: { readonly retainContextWhenHidden?: boolean } }
    ): Disposable;
  }

  export namespace workspace {
    export const workspaceFolders: readonly WorkspaceFolder[] | undefined;
    export function getConfiguration(section?: string): WorkspaceConfiguration;
    export function onDidChangeConfiguration(listener: (e: any) => any, thisArgs?: any, disposables?: Disposable[]): Disposable;
    export function applyEdit(edit: WorkspaceEdit): Thenable<boolean>;
    export function registerTextDocumentContentProvider(
      scheme: string,
      provider: TextDocumentContentProvider
    ): Disposable;
    export function openTextDocument(uriOrFileName: Uri | string): Thenable<TextDocument>;
    export const textDocuments: readonly TextDocument[];
    export function asRelativePath(pathOrUri: string | Uri, includeWorkspaceFolder?: boolean): string;
    export const onDidChangeTextDocument: Event<TextDocumentChangeEvent>;
    export const onDidOpenTextDocument: Event<TextDocument>;
    export const onDidCloseTextDocument: Event<TextDocument>;
  }

  export namespace env {
    export const clipboard: {
      readText(): Thenable<string>;
      writeText(value: string): Thenable<void>;
    };
  }
}
