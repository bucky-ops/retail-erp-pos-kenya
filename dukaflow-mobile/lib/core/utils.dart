import 'package:intl/intl.dart';

/// KES money formatter — "KES 1,250" / compact "KES 1.3M".
String kes(num n, {bool compact = false}) {
  if (compact) {
    if (n.abs() >= 1000000) return 'KES ${(n / 1000000).toStringAsFixed(1)}M';
    if (n.abs() >= 1000) return 'KES ${(n / 1000).toStringAsFixed(1)}K';
  }
  final f = NumberFormat('#,##0', 'en_ke');
  return 'KES ${f.format(n.round())}';
}

String fmtDate(DateTime d) => DateFormat('dd MMM yyyy, HH:mm').format(d);

String fmtDateShort(DateTime d) => DateFormat('dd MMM').format(d);

String hhmm(DateTime d) => DateFormat('HH:mm').format(d);

/// Deterministic pastel-ish tint from a string (for avatars).
String initialsOf(String name) => name
    .split(' ')
    .where((w) => w.isNotEmpty)
    .map((w) => w[0])
    .take(2)
    .join()
    .toUpperCase();
