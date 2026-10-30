pub mod client;
pub mod detector;

pub use client::{
    create_lsp_state, get_lsp_status, request_lsp_definition, request_lsp_diagnostics,
    request_lsp_document_highlights, request_lsp_document_symbols, request_lsp_hover,
    request_lsp_references, request_lsp_workspace_symbols, send_lsp_did_change,
    send_lsp_did_open, start_lsp_server, stop_lsp_server, LspDiagnostic,
    LspHighlight, LspHoverResponse, LspLocation, LspManager, LspManagerRef,
    LspRange, LspSession, LspStatus, LspSymbol,
};

pub use detector::{
    auto_start_lsp_for_file, detect_all_servers, detect_language_servers,
    detect_server_for_file, detect_server_for_file_cmd, detect_server_for_language,
    get_known_language_specs, DetectedServer, LanguageServerSpec,
};

