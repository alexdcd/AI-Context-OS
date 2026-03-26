use std::fs;
use std::io::{Read, Write};
use std::path::Path;

use tauri::State;
use zip::write::SimpleFileOptions;

use crate::state::AppState;

/// Create a .zip backup of the entire workspace.
/// Returns the path to the created zip file.
#[tauri::command]
pub fn backup_workspace(destination: String, state: State<AppState>) -> Result<String, String> {
    let root = state.get_root();
    let dest_path = Path::new(&destination);

    let file = fs::File::create(dest_path)
        .map_err(|e| format!("Failed to create backup file: {}", e))?;

    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    add_dir_to_zip(&mut zip, &root, &root, options)?;

    zip.finish()
        .map_err(|e| format!("Failed to finalize zip: {}", e))?;

    Ok(destination)
}

/// Restore workspace from a .zip backup.
/// Extracts into the workspace root, overwriting existing files.
#[tauri::command]
pub fn restore_workspace(source: String, state: State<AppState>) -> Result<bool, String> {
    let root = state.get_root();
    let source_path = Path::new(&source);

    let file = fs::File::open(source_path)
        .map_err(|e| format!("Failed to open backup file: {}", e))?;

    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Invalid zip file: {}", e))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {}", e))?;

        let entry_path = match entry.enclosed_name() {
            Some(p) => root.join(p),
            None => continue,
        };

        if entry.is_dir() {
            fs::create_dir_all(&entry_path)
                .map_err(|e| format!("Failed to create dir: {}", e))?;
        } else {
            if let Some(parent) = entry_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create parent dir: {}", e))?;
            }
            let mut outfile = fs::File::create(&entry_path)
                .map_err(|e| format!("Failed to create file: {}", e))?;
            let mut buf = Vec::new();
            entry
                .read_to_end(&mut buf)
                .map_err(|e| format!("Failed to read zip entry data: {}", e))?;
            outfile
                .write_all(&buf)
                .map_err(|e| format!("Failed to write file: {}", e))?;
        }
    }

    Ok(true)
}

fn add_dir_to_zip<W: Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    dir: &Path,
    root: &Path,
    options: SimpleFileOptions,
) -> Result<(), String> {
    let entries = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read dir {}: {}", dir.display(), e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|e| format!("Path error: {}", e))?;
        let name = relative.to_string_lossy().to_string();

        if path.is_dir() {
            zip.add_directory(&format!("{}/", name), options)
                .map_err(|e| format!("Failed to add dir to zip: {}", e))?;
            add_dir_to_zip(zip, &path, root, options)?;
        } else {
            zip.start_file(&name, options)
                .map_err(|e| format!("Failed to start zip entry: {}", e))?;
            let data = fs::read(&path)
                .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
            zip.write_all(&data)
                .map_err(|e| format!("Failed to write zip data: {}", e))?;
        }
    }

    Ok(())
}
