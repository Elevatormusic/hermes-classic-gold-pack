/* Classic Hermes — gold & kawaii.  Paste into Hermes Desktop DevTools console
   (Ctrl+Shift+I → Console), press Enter.  Installs + activates the gold theme
   (dark mode) and reloads.  To revert: pick another theme in Appearance, or run
   localStorage.setItem('hermes-desktop-theme-v2','nous');location.reload();      */
(() => {
  const t = {
    "name": "hermes-classic-gold", "label": "Classic Hermes",
    "description": "Gold and kawaii - warm gold borders, cornsilk text",
    "colors": {"background": "#FFFDF6", "foreground": "#3A2E12", "card": "#FFFFFF", "cardForeground": "#3A2E12", "muted": "#F5EED9", "mutedForeground": "#7A6A3A", "popover": "#FFFFFF", "popoverForeground": "#3A2E12", "primary": "#B8860B", "primaryForeground": "#FFFDF6", "secondary": "#F0E6C8", "secondaryForeground": "#3A2E12", "accent": "#CD7F32", "accentForeground": "#FFFDF6", "border": "#CD7F32", "input": "#E8DCB8", "ring": "#B8860B", "midground": "#CD7F32", "composerRing": "#B8860B", "destructive": "#C72E4D", "destructiveForeground": "#FFFFFF", "sidebarBackground": "#FBF6E8", "sidebarBorder": "#DAA520", "userBubble": "#F5EED9", "userBubbleBorder": "#DAA520"},
    "darkColors": {"background": "#1A160F", "foreground": "#FFF8DC", "card": "#241E15", "cardForeground": "#FFF8DC", "muted": "#2E2717", "mutedForeground": "#C9B78A", "popover": "#241E15", "popoverForeground": "#FFF8DC", "primary": "#FFD700", "primaryForeground": "#1A160F", "secondary": "#3A311D", "secondaryForeground": "#FFF8DC", "accent": "#CD7F32", "accentForeground": "#1A160F", "border": "#CD7F32", "input": "#2E2717", "ring": "#FFD700", "midground": "#B8860B", "composerRing": "#FFD700", "destructive": "#C0473A", "destructiveForeground": "#FEF2F2", "sidebarBackground": "#14110B", "sidebarBorder": "#8B6914", "userBubble": "#2A2315", "userBubbleBorder": "#B8860B"},
    "typography": {"fontSans": "\"Cascadia Code\", \"JetBrains Mono\", Consolas, ui-monospace, monospace, \"Segoe UI Emoji\", \"Segoe UI Symbol\", emoji", "fontMono": "\"Cascadia Code\", \"JetBrains Mono\", Consolas, ui-monospace, monospace, \"Segoe UI Emoji\", \"Segoe UI Symbol\", emoji"}
  };
  // 1) register in the user-themes registry
  const K = 'hermes-desktop-user-themes-v1';
  const reg = JSON.parse(localStorage.getItem(K) || '{}');
  reg[t.name] = t;
  localStorage.setItem(K, JSON.stringify(reg));
  // 2) activate it (default profile) + dark mode — raw strings, per lib/storage.persistString
  localStorage.setItem('hermes-desktop-theme-v2', t.name);
  localStorage.setItem('hermes-desktop-mode-v1', 'dark');
  console.log('Installed + activated:', t.label);
  location.reload();
})();
