use crate::core::application::Application;
use anyhow::{Context, Result};
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

pub fn load_all(app_dir: &Path) -> Result<Vec<Application>> {
    let mut apps = Vec::new();

    for entry in WalkDir::new(app_dir).max_depth(2) {
        let entry = entry?;

        if entry.file_name() == "app.yaml" {
            let content_res = fs::read_to_string(entry.path())
                .with_context(|| format!("reading: {:?}", entry.path()));
            
            let content = match content_res {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[registry] warning: failed to read {:?} - {}", entry.path(), e);
                    continue;
                }
            };

            let app_res: Result<Application, _> = serde_yaml::from_str(&content)
                .with_context(|| format!("parsing: {:?}", entry.path()));
            
            match app_res {
                Ok(app) => apps.push(app),
                Err(e) => {
                    eprintln!("[registry] warning: failed to parse {:?} - {}", entry.path(), e);
                }
            }
        }
    }

    Ok(apps)
}
