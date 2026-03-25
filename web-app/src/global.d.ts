// Extend the Window interface to include the injected ethereum provider.
interface Window {
  ethereum?: Record<string, unknown>;
}
