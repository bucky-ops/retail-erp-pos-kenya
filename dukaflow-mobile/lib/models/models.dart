/// All DukaFlow models. Stored in Hive as JSON maps (offline-first),
/// so every model has fromJson/toJson — no codegen needed.
library models;

class Product {
  final int id;
  final String name;
  final String sku;
  final String barcode;
  final String category;
  final double price;
  final double cost;
  final String unit;
  final String emoji;
  final int qty; // aggregate on-hand across stores (mobile sells from its store)
  final int reorderPoint;

  const Product({
    required this.id,
    required this.name,
    required this.sku,
    required this.barcode,
    required this.category,
    required this.price,
    required this.cost,
    this.unit = 'pc',
    this.emoji = '📦',
    this.qty = 0,
    this.reorderPoint = 0,
  });

  bool get isLow => qty <= reorderPoint;

  factory Product.fromJson(Map<String, dynamic> j) => Product(
        id: (j['id'] as num?)?.toInt() ?? 0,
        name: (j['name'] as String?) ?? '',
        sku: (j['sku'] as String?) ?? '',
        barcode: (j['barcode'] as String?) ?? '',
        category: (j['category'] as String?) ?? 'General',
        price: (j['price'] as num?)?.toDouble() ?? 0,
        cost: (j['cost'] as num?)?.toDouble() ?? 0,
        unit: (j['unit'] as String?) ?? 'pc',
        emoji: (j['emoji'] as String?) ?? '📦',
        qty: (j['qty'] as num?)?.toInt() ?? 0,
        reorderPoint: (j['reorderPoint'] as num?)?.toInt() ?? 0,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'sku': sku,
        'barcode': barcode,
        'category': category,
        'price': price,
        'cost': cost,
        'unit': unit,
        'emoji': emoji,
        'qty': qty,
        'reorderPoint': reorderPoint,
      };
}

class CartLine {
  final Product product;
  final double qty;
  final double unitDiscount;

  const CartLine({required this.product, required this.qty, this.unitDiscount = 0});

  double get lineTotal => (product.price - unitDiscount) * qty;

  CartLine copyWith({double? qty, double? unitDiscount}) => CartLine(
        product: product,
        qty: qty ?? this.qty,
        unitDiscount: unitDiscount ?? this.unitDiscount,
      );

  Map<String, dynamic> toJson() => {
        'productId': product.id,
        'name': product.name,
        'sku': product.sku,
        'price': product.price,
        'qty': qty,
        'unitDiscount': unitDiscount,
        'total': lineTotal,
      };
}

class CartTotals {
  final double subtotal;
  final double discount;
  final double vat;
  final double total;

  const CartTotals({
    required this.subtotal,
    required this.discount,
    required this.vat,
    required this.total,
  });

  factory CartTotals.compute(List<CartLine> lines, double extraDiscount) {
    final subtotal = lines.fold<double>(0, (s, l) => s + l.lineTotal);
    final discount = extraDiscount;
    final net = (subtotal - discount).clamp(0, double.infinity);
    final vat = net * 0.16;
    return CartTotals(
      subtotal: subtotal,
      discount: discount,
      vat: vat,
      total: net + vat,
    );
  }
}

class Customer {
  final int id;
  final String name;
  final String phone;
  final String tier;
  final int loyaltyPoints;
  final double totalSpent;
  final double debtBalance;
  final double creditLimit;
  final double giftCardBalance;

  const Customer({
    required this.id,
    required this.name,
    required this.phone,
    this.tier = 'Bronze',
    this.loyaltyPoints = 0,
    this.totalSpent = 0,
    this.debtBalance = 0,
    this.creditLimit = 0,
    this.giftCardBalance = 0,
  });

  factory Customer.fromJson(Map<String, dynamic> j) => Customer(
        id: (j['id'] as num?)?.toInt() ?? 0,
        name: (j['name'] as String?) ?? '',
        phone: (j['phone'] as String?) ?? '',
        tier: (j['tier'] as String?) ?? 'Bronze',
        loyaltyPoints: (j['loyaltyPoints'] as num?)?.toInt() ?? 0,
        totalSpent: (j['totalSpent'] as num?)?.toDouble() ?? 0,
        debtBalance: (j['debtBalance'] as num?)?.toDouble() ?? 0,
        creditLimit: (j['creditLimit'] as num?)?.toDouble() ?? 0,
        giftCardBalance: (j['giftCardBalance'] as num?)?.toDouble() ?? 0,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'phone': phone,
        'tier': tier,
        'loyaltyPoints': loyaltyPoints,
        'totalSpent': totalSpent,
        'debtBalance': debtBalance,
        'creditLimit': creditLimit,
        'giftCardBalance': giftCardBalance,
      };
}

/// Payment method — mirrors the web POS options.
enum PaymentMethod { cash, mpesaStk, card, creditSale }

extension PaymentMethodX on PaymentMethod {
  String get label => switch (this) {
        PaymentMethod.cash => 'Cash',
        PaymentMethod.mpesaStk => 'M-Pesa STK',
        PaymentMethod.card => 'Card',
        PaymentMethod.creditSale => 'Credit Sale',
      };

  String get wire => switch (this) {
        PaymentMethod.cash => 'Cash',
        PaymentMethod.mpesaStk => 'M-Pesa Till',
        PaymentMethod.card => 'Card',
        PaymentMethod.creditSale => 'Credit Sale',
      };
}

/// A sale — created OFFLINE first, then synced.
class Sale {
  final String id; // client UUID (also used as clientId on sync)
  final String receiptNo; // provisional offline no; server may reassign
  final String? serverReceiptNo;
  final int? customerId;
  final String? customerName;
  final String staffName;
  final List<CartLine> lines;
  final String paymentMethod; // wire label
  final double subtotal;
  final double discount;
  final double vat;
  final double total;
  final double tendered;
  final bool redeemLoyalty;
  final bool synced;
  final DateTime createdAt;
  final String? syncedAt;

  const Sale({
    required this.id,
    required this.receiptNo,
    this.serverReceiptNo,
    this.customerId,
    this.customerName,
    required this.staffName,
    required this.lines,
    required this.paymentMethod,
    required this.subtotal,
    required this.discount,
    required this.vat,
    required this.total,
    this.tendered = 0,
    this.redeemLoyalty = false,
    this.synced = false,
    required this.createdAt,
    this.syncedAt,
  });

  String get displayNo => serverReceiptNo ?? receiptNo;

  factory Sale.fromJson(Map<String, dynamic> j) => Sale(
        id: (j['id'] as String?) ?? '',
        receiptNo: (j['receiptNo'] as String?) ?? '',
        serverReceiptNo: j['serverReceiptNo'] as String?,
        customerId: (j['customerId'] as num?)?.toInt(),
        customerName: j['customerName'] as String?,
        staffName: (j['staffName'] as String?) ?? 'Mobile',
        lines: ((j['lines'] as List?) ?? [])
            .map((l) => CartLine(
                  product: Product(
                    id: (l['productId'] as num?)?.toInt() ?? 0,
                    name: (l['name'] as String?) ?? '',
                    sku: (l['sku'] as String?) ?? '',
                    barcode: '',
                    category: '',
                    price: (l['price'] as num?)?.toDouble() ?? 0,
                  ),
                  qty: (l['qty'] as num?)?.toDouble() ?? 0,
                  unitDiscount: (l['unitDiscount'] as num?)?.toDouble() ?? 0,
                ))
            .toList(),
        paymentMethod: (j['paymentMethod'] as String?) ?? 'Cash',
        subtotal: (j['subtotal'] as num?)?.toDouble() ?? 0,
        discount: (j['discount'] as num?)?.toDouble() ?? 0,
        vat: (j['vat'] as num?)?.toDouble() ?? 0,
        total: (j['total'] as num?)?.toDouble() ?? 0,
        tendered: (j['tendered'] as num?)?.toDouble() ?? 0,
        redeemLoyalty: (j['redeemLoyalty'] as bool?) ?? false,
        synced: (j['synced'] as bool?) ?? false,
        createdAt: DateTime.tryParse((j['createdAt'] as String?) ?? '') ?? DateTime.now(),
        syncedAt: j['syncedAt'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'receiptNo': receiptNo,
        'serverReceiptNo': serverReceiptNo,
        'customerId': customerId,
        'customerName': customerName,
        'staffName': staffName,
        'lines': lines.map((l) => l.toJson()).toList(),
        'paymentMethod': paymentMethod,
        'subtotal': subtotal,
        'discount': discount,
        'vat': vat,
        'total': total,
        'tendered': tendered,
        'redeemLoyalty': redeemLoyalty,
        'synced': synced,
        'createdAt': createdAt.toIso8601String(),
        'syncedAt': syncedAt,
      };

  /// Payload sent to POST /api/sales (matches the web API contract).
  Map<String, dynamic> toSyncPayload() => {
        'clientId': id,
        'offlineCreated': true,
        'customerId': customerId,
        'staffName': staffName,
        'paymentMethod': paymentMethod,
        'subtotal': subtotal,
        'discount': discount,
        'vat': vat,
        'total': total,
        'pointsRedeemed': redeemLoyalty ? (total ~/ 10) : 0,
        'items': lines
            .map((l) => {
                  'productId': l.product.id,
                  'qty': l.qty,
                  'price': l.product.price - l.unitDiscount,
                })
            .toList(),
      };
}

class StaffUser {
  final int id;
  final String name;
  final String role;
  final String color;
  final int? storeId;
  final String? storeName;

  const StaffUser({
    required this.id,
    required this.name,
    required this.role,
    this.color = '#0052CC',
    this.storeId,
    this.storeName,
  });

  bool get isOwner => role.toLowerCase() == 'owner';

  factory StaffUser.fromJson(Map<String, dynamic> j) => StaffUser(
        id: (j['id'] as num?)?.toInt() ?? 0,
        name: (j['name'] as String?) ?? '',
        role: (j['role'] as String?) ?? 'Cashier',
        color: (j['color'] as String?) ?? '#0052CC',
        storeId: (j['storeId'] as num?)?.toInt(),
        storeName: j['storeName'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'role': role,
        'color': color,
        'storeId': storeId,
        'storeName': storeName,
      };
}

class DebtPlan {
  final int id;
  final String invoiceNo;
  final String customerName;
  final double totalDebt;
  final double installmentAmount;
  final String installmentType;
  final String nextDueDate;
  final int overdueDays;
  final String status;

  const DebtPlan({
    required this.id,
    required this.invoiceNo,
    required this.customerName,
    required this.totalDebt,
    required this.installmentAmount,
    required this.installmentType,
    required this.nextDueDate,
    required this.overdueDays,
    required this.status,
  });

  factory DebtPlan.fromJson(Map<String, dynamic> j) => DebtPlan(
        id: (j['id'] as num?)?.toInt() ?? 0,
        invoiceNo: (j['invoiceNo'] as String?) ?? '',
        customerName: (j['customer']?['name'] as String?) ??
            (j['customerName'] as String?) ??
            'Customer',
        totalDebt: (j['totalDebt'] as num?)?.toDouble() ?? 0,
        installmentAmount: (j['installmentAmount'] as num?)?.toDouble() ?? 0,
        installmentType: (j['installmentType'] as String?) ?? 'Monthly',
        nextDueDate: (j['nextDueDate'] as String?) ?? '',
        overdueDays: (j['overdueDays'] as num?)?.toInt() ?? 0,
        status: (j['status'] as String?) ?? 'Active',
      );
}

class StockRow {
  final Product product;
  final int qty;
  final int reorderPoint;

  const StockRow({required this.product, required this.qty, required this.reorderPoint});
}

class DashboardData {
  final double todaySales;
  final int todayCount;
  final double weekSales;
  final double debtOutstanding;
  final int lowStock;
  final double stockValue;

  const DashboardData({
    required this.todaySales,
    required this.todayCount,
    required this.weekSales,
    required this.debtOutstanding,
    required this.lowStock,
    required this.stockValue,
  });

  static const empty = DashboardData(
    todaySales: 0,
    todayCount: 0,
    weekSales: 0,
    debtOutstanding: 0,
    lowStock: 0,
    stockValue: 0,
  );
}
