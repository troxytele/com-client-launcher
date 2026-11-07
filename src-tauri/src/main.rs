// no console window next to the launcher on Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    com_client_launcher_lib::run()
}
