-- Karatasi: floating markdown notes for Omarchy.
--
-- Load this from ~/.config/hypr/hyprland.lua after Omarchy's defaults
-- (`karatasi-setup` adds the line for you):
--
--   dofile("/usr/share/karatasi/hypr/karatasi.lua")
--
-- Set any of these before the dofile line to change the defaults:
--
--   karatasi_toggle_key = "SUPER + CTRL + ALT + SHIFT + N"  -- Hyper N
--   karatasi_close_key  = "SUPER + W"                       -- false to leave Omarchy's close key alone
--   karatasi_autostart  = true                              -- keep it warm so the toggle is instant

local toggle_key = karatasi_toggle_key or "SUPER + CTRL + ALT + SHIFT + N"
local close_key = karatasi_close_key
if close_key == nil then close_key = "SUPER + W" end
local autostart = karatasi_autostart
if autostart == nil then autostart = true end

o.bind(toggle_key, "Notes: toggle Karatasi", "karatasi toggle")

-- The close key hides Karatasi instead of quitting it, and closes anything else as usual.
if close_key then
  hl.unbind(close_key)
  o.bind(close_key, "Close window (hides Karatasi)", function()
    local window = hl.get_active_window()
    if window and window.class == "karatasi" then
      hl.dispatch(hl.dsp.exec_cmd("karatasi hide"))
    else
      hl.dispatch(hl.dsp.window.close())
    end
  end)
end

-- The editor floats pinned and centered, opaque for readability. The main window is titled
-- exactly "Karatasi"; other note windows are "Karatasi - <note title>". Super T tiles a window
-- on demand; the toggle key then spawns a fresh floating one.
o.window({ class = "^karatasi$", title = "^Karatasi Search$" }, {
  tag = "-default-opacity",
  opacity = "1 1",
  float = true,
  pin = true,
  size = { 680, 440 },
  center = true,
  border_size = 1,
})
-- Ctrl+Shift+N from a tiled note spawns the new window with this title so it tiles instead of
-- floating; Karatasi retitles it once the note loads (float rules only apply on map).
o.window({ class = "^karatasi$", title = "^Karatasi Tiled$" }, {
  tag = "-default-opacity",
  opacity = "1 1",
  float = false,
})
o.window({ class = "^karatasi$", title = "^Karatasi( - .*)?$" }, {
  tag = "-default-opacity",
  opacity = "1 1",
  float = true,
  pin = true,
  size = { 960, 720 },
  center = true,
  focus_on_activate = false,
})

if autostart then
  o.launch_on_start("karatasi start")
end
