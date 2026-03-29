// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    match ai_context_os::try_run_embedded_mcp_server() {
        Ok(true) => {}
        Ok(false) => ai_context_os::run(),
        Err(err) => {
            eprintln!("{}", err);
            std::process::exit(1);
        }
    }
}
