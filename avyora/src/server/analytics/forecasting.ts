/**
 * Lightweight margin and inventory forecasting helpers.
 * Assumptions are documented inline — not predictive ML models.
 */

export type MarginOrderItem = {
  quantity: number;
  unitPrice: number;
  /** Optional unit cost (COGS) per line item. */
  cost?: number;
};

export type MarginOrder = {
  id?: string;
  subtotal?: number;
  total: number;
  /** Subtracted from total when computing revenue. */
  refundedAmount?: number;
  discount?: number;
  shipping?: number;
  tax?: number;
  items?: MarginOrderItem[];
  /** Optional order-level cost override when line costs are unavailable. */
  cost?: number;
};

export type MarginMetrics = {
  orderCount: number;
  revenue: number;
  cost: number;
  grossProfit: number;
  grossMarginPercent: number;
  averageOrderValue: number;
  itemsSold: number;
  /** Orders where cost data was incomplete. */
  ordersWithMissingCost: number;
};

/**
 * Computes aggregate margin metrics from orders.
 *
 * Assumptions:
 * - Revenue uses `total - refundedAmount` (net of refunds).
 * - Line cost, when present, is multiplied by quantity and summed.
 * - If no line costs exist but `order.cost` is set, that value is used.
 * - Orders without any cost signal increment `ordersWithMissingCost` and contribute
 *   revenue only (cost treated as 0 for that order).
 */
export function computeMarginMetrics(orders: MarginOrder[]): MarginMetrics {
  let revenue = 0;
  let cost = 0;
  let itemsSold = 0;
  let ordersWithMissingCost = 0;

  for (const order of orders) {
    const refunded = order.refundedAmount != null && order.refundedAmount > 0 ? order.refundedAmount : 0;
    revenue += Math.max(0, order.total - refunded);

    let orderCost = 0;
    let hasCost = false;

    if (order.items?.length) {
      for (const item of order.items) {
        itemsSold += item.quantity;
        if (item.cost != null) {
          orderCost += item.cost * item.quantity;
          hasCost = true;
        }
      }
    }

    if (!hasCost && order.cost != null) {
      orderCost = order.cost;
      hasCost = true;
    }

    if (!hasCost) {
      ordersWithMissingCost += 1;
    }

    cost += orderCost;
  }

  const orderCount = orders.length;
  const grossProfit = revenue - cost;
  const grossMarginPercent = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
  const averageOrderValue = orderCount > 0 ? revenue / orderCount : 0;

  return {
    orderCount,
    revenue,
    cost,
    grossProfit,
    grossMarginPercent,
    averageOrderValue,
    itemsSold,
    ordersWithMissingCost,
  };
}

export type ForecastReorderInput = {
  /** Average units sold per day (rolling mean). */
  dailySalesAvg: number;
  /** Current on-hand stock in units. */
  stock: number;
  /** Supplier lead time in calendar days. */
  leadTimeDays: number;
  /** Safety buffer in days of cover to keep after lead time. */
  safetyDays: number;
};

export type ForecastReorderResult = {
  reorderPoint: number;
  daysUntilStockout: number | null;
  shouldReorder: boolean;
  suggestedOrderQty: number;
  projectedStockAtReorder: number;
};

/**
 * Simple reorder-point forecast.
 *
 * Assumptions:
 * - Demand is steady at `dailySalesAvg` units/day (no seasonality).
 * - Lead time and safety days are calendar days.
 * - Reorder point = dailySalesAvg × (leadTimeDays + safetyDays).
 * - Suggested order quantity tops up to one full reorder cycle:
 *   reorderPoint + (dailySalesAvg × leadTimeDays) − current stock.
 * - If dailySalesAvg is 0, no reorder is suggested.
 */
export function forecastReorder(input: ForecastReorderInput): ForecastReorderResult {
  const { dailySalesAvg, stock, leadTimeDays, safetyDays } = input;

  if (dailySalesAvg <= 0) {
    return {
      reorderPoint: 0,
      daysUntilStockout: null,
      shouldReorder: false,
      suggestedOrderQty: 0,
      projectedStockAtReorder: stock,
    };
  }

  const reorderPoint = dailySalesAvg * (leadTimeDays + safetyDays);
  const daysUntilStockout = stock / dailySalesAvg;
  const shouldReorder = stock <= reorderPoint;
  const targetStock = reorderPoint + dailySalesAvg * leadTimeDays;
  const suggestedOrderQty = shouldReorder ? Math.max(0, Math.ceil(targetStock - stock)) : 0;
  const projectedStockAtReorder = stock - dailySalesAvg * leadTimeDays;

  return {
    reorderPoint,
    daysUntilStockout,
    shouldReorder,
    suggestedOrderQty,
    projectedStockAtReorder,
  };
}
