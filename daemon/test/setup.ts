// Loaded before every test file (bunfig.toml). Keeps test runs off the
// keychain items that encrypt a real Nova store.
process.env.NOVA_KEYCHAIN_SERVICE = "dev.nova.keys.test";
