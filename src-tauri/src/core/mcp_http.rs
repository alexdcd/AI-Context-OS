use std::sync::Arc;

use axum::Router;
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::tower::StreamableHttpService;
use rmcp::transport::streamable_http_server::StreamableHttpServerConfig;
use tower_http::cors::{Any, CorsLayer};

use crate::core::mcp::{AiContextMcpServer, McpSharedState};

/// Default port for the MCP HTTP server.
pub const MCP_HTTP_PORT: u16 = 3847;

/// Build the Axum router for the MCP HTTP/SSE server.
pub fn build_mcp_router(shared_state: Arc<McpSharedState>) -> Router {
    let config = StreamableHttpServerConfig {
        stateful_mode: true,
        json_response: true,
        ..Default::default()
    };

    let session_manager = LocalSessionManager::default();

    let factory = move || {
        let state = shared_state.clone();
        AiContextMcpServer::new(state)
    };

    let mcp_service = StreamableHttpService::new(factory, session_manager, config);

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .nest_service("/mcp", mcp_service)
        .layer(cors)
}

/// Spawn the MCP HTTP server as a background tokio task.
/// Returns the port it's listening on.
pub async fn spawn_mcp_http_server(shared_state: Arc<McpSharedState>) -> Result<u16, String> {
    let router = build_mcp_router(shared_state);
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], MCP_HTTP_PORT));

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Failed to bind MCP HTTP server to {}: {}", addr, e))?;

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, router).await {
            eprintln!("MCP HTTP server error: {}", e);
        }
    });

    Ok(MCP_HTTP_PORT)
}
