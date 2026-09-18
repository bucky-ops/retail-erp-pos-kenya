/// App-wide constants.
abstract final class AppConstants {
  static const appName = 'DukaFlow';
  static const tagline = 'Sell Smart. Stock Smart.';

  /// Default backend — overridable in Settings (Hive `settings` box).
  static const defaultBaseUrl = 'https://api.dukaflow.site';

  /// VAT rate used across totals (Kenya standard rate).
  static const vatRate = 0.16;

  /// Loyalty: points earned per KES 100 spent.
  static const loyaltyEarnPerKes = 100;

  /// Offline queue box names (Hive).
  static const pendingSalesBox = 'pending_sales';
  static const productsBox = 'products_cache';
  static const customersBox = 'customers_cache';
  static const receiptsBox = 'receipts_cache';
  static const settingsBox = 'settings';

  /// Workmanager background sync task.
  static const syncTaskName = 'dukaflow.sync';
  static const syncTaskId = 'dukaflow-sync-periodic';

  /// Variance tolerance for cash drawer (KES) — matches web Day Close.
  static const varianceTolerance = 100.0;
}
