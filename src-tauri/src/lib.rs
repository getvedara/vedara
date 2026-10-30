pub mod commands;
pub mod fs;
pub mod terminal;
pub mod inference;
pub mod git;
pub mod ast;
pub mod rag;
pub mod lsp;
pub mod hardware;
pub mod router;
pub mod mcp;
pub mod security;
pub mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(workspace::WorkspaceState::new())
        .manage(terminal::pty::TerminalManager::new())
        .manage(inference::InferenceManager::default())
        .manage(rag::create_bm25_state())
        .manage(rag::create_vector_store_state())
        .manage(lsp::create_lsp_state())
        .manage(hardware::create_sentinel_state())
        .manage(router::create_router_state())
        .manage(mcp::create_mcp_state())
        .manage(security::create_audit_logger_state())
        .manage(security::create_policy_engine_state())
        .invoke_handler(tauri::generate_handler![
            commands::system::get_system_info,
            workspace::set_workspace_root,
            workspace::get_workspace_root,
            workspace::get_recent_workspaces,
            workspace::load_workspace_session,
            workspace::save_workspace_session,
            workspace::load_app_settings,
            workspace::save_app_settings,
            fs::read_workspace_tree,
            fs::read_file_content,
            fs::write_file_content,
            fs::create_file,
            fs::delete_path,
            terminal::spawn_terminal_session,
            terminal::write_terminal_input,
            terminal::resize_terminal,
            terminal::close_terminal_session,
            inference::check_inference_health,
            inference::daemon::check_ollama_installed,
            inference::daemon::start_ollama_service,
            inference::stream_completion,
            inference::stream_chat,
            inference::abort_completion,
            inference::get_hardware_tier,
            inference::get_model_residency,
            inference::evict_model,
            inference::evict_idle_models,
            git::create_checkpoint,
            git::list_checkpoints,
            git::restore_checkpoint,
            git::get_checkpoint_diff,
            git::restore_checkpoint_file,
            git::restore_checkpoint_files,
            ast::slicer::slice_file_ast,
            ast::slicer::generate_repo_skeleton,
            rag::bm25::build_bm25_index,
            rag::bm25::search_bm25,
            rag::bm25::sync_bm25_file_changes,
            rag::bm25::get_bm25_index_status,
            rag::aggregator::aggregate_codebase_context,
            rag::embeddings::chunk_file_content,
            rag::embeddings::compute_text_embedding,
            rag::embeddings::compute_cosine_similarity,
            rag::vector_store::index_workspace_vectors,
            rag::vector_store::search_codebase_vectors,
            rag::vector_store::get_vector_store_status,
            rag::hybrid::search_hybrid_codebase,
            rag::reranker::rerank_hybrid_candidates,
            rag::reranker::retrieve_and_rerank_codebase,
            lsp::client::start_lsp_server,
            lsp::client::stop_lsp_server,
            lsp::client::get_lsp_status,
            lsp::client::send_lsp_did_open,
            lsp::client::send_lsp_did_change,
            lsp::client::request_lsp_hover,
            lsp::client::request_lsp_definition,
            lsp::client::request_lsp_diagnostics,
            lsp::client::request_lsp_document_symbols,
            lsp::client::request_lsp_workspace_symbols,
            lsp::client::request_lsp_document_highlights,
            lsp::client::request_lsp_references,
            lsp::detector::detect_language_servers,
            lsp::detector::detect_server_for_file_cmd,
            lsp::detector::auto_start_lsp_for_file,
            hardware::get_hardware_memory_profile,
            hardware::set_hardware_tier_override,
            hardware::evict_model_from_sentinel,
            hardware::evict_idle_models_from_sentinel,
            hardware::get_clamped_context_budget,
            router::route_task_cmd,
            router::classify_prompt_task_cmd,
            router::get_model_router_config_cmd,
            router::set_model_router_config_cmd,
            mcp::start_mcp_server,
            mcp::stop_mcp_server,
            mcp::list_mcp_servers,
            mcp::list_mcp_tools,
            mcp::call_mcp_tool,
            mcp::get_mcp_server_status,
            security::network_guard::validate_network_target_cmd,
            security::audit_logger::log_audit_event_cmd,
            security::audit_logger::query_audit_log_cmd,
            security::audit_logger::verify_audit_log_integrity_cmd,
            security::audit_logger::export_audit_log_sql_cmd,
            security::policy_engine::load_policy_rules_cmd,
            security::policy_engine::save_policy_rules_cmd,
            security::policy_engine::evaluate_file_access_cmd,
            security::policy_engine::evaluate_prompt_policy_cmd,
            security::policy_engine::evaluate_tool_execution_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vedara");
}
