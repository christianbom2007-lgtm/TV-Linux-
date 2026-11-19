// Lichtung TV – Firefox-Einstellungen (werden bei jedem Start übernommen)
user_pref("browser.startup.homepage", "http://127.0.0.1:8770/");
user_pref("browser.startup.page", 1);
user_pref("browser.sessionstore.resume_from_crash", false);
user_pref("toolkit.startup.max_resumed_crashes", -1);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.aboutwelcome.enabled", false);
user_pref("browser.aboutConfig.showWarning", false);
user_pref("browser.tabs.warnOnClose", false);
user_pref("browser.warnOnQuit", false);
user_pref("browser.newtabpage.enabled", false);
user_pref("browser.translations.automaticallyPopup", false);
user_pref("intl.accept_languages", "de-DE, de, en");
user_pref("intl.locale.requested", "de");
// Neue Fenster/Tabs in der gleichen Ansicht öffnen (kein Tab-Chaos im Kiosk)
user_pref("browser.link.open_newwindow", 1);
user_pref("browser.link.open_newwindow.restriction", 0);
// Vollbild ohne Hinweis und ohne Animation
user_pref("full-screen-api.warning.timeout", 0);
user_pref("full-screen-api.transition-duration.enter", "0 0");
user_pref("full-screen-api.transition-duration.leave", "0 0");
// Videos dürfen automatisch starten
user_pref("media.autoplay.default", 0);
user_pref("media.autoplay.blocking_policy", 0);
// Hardware-Videobeschleunigung (VA-API) – entlastet den Prozessor stark
user_pref("media.ffmpeg.vaapi.enabled", true);
user_pref("media.hardware-video-decoding.force-enabled", true);
user_pref("gfx.webrender.all", true);
user_pref("widget.dmabuf.force-enabled", true);
// DRM für Netflix & Co. (Widevine wird von Firefox automatisch geladen)
user_pref("media.eme.enabled", true);
user_pref("media.gmp-widevinecdm.visible", true);
user_pref("media.gmp-widevinecdm.enabled", true);
// Eigene Lichtung-Erweiterung ist nicht bei Mozilla signiert → in Firefox ESR erlaubt
user_pref("xpinstall.signatures.required", false);
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.enabledScopes", 15);
// Ruhe: keine Benachrichtigungs-/Standortanfragen, keine Telemetrie
user_pref("permissions.default.desktop-notification", 2);
user_pref("permissions.default.geo", 2);
user_pref("datareporting.healthreport.uploadEnabled", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("toolkit.telemetry.enabled", false);
user_pref("app.shield.optoutstudies.enabled", false);
user_pref("ui.key.menuAccessKeyFocuses", false);
user_pref("apz.overscroll.enabled", false);
user_pref("general.smoothScroll", true);
// Webseiten etwas größer darstellen – besser lesbar vom Sofa (1.0 = normal)
user_pref("layout.css.devPixelsPerPx", "__ZOOM__");
