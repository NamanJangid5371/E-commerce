export type ShipmentAddress = {
  name: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
};

export type CreateShipmentInput = {
  orderId: string;
  orderNumber?: string;
  weightGrams?: number;
  codAmount?: number;
  pickupAddress?: ShipmentAddress;
  deliveryAddress: ShipmentAddress;
  /** Staff-supplied AWB when using the manual provider. */
  awbOverride?: string;
  partnerName?: string;
};

export type CreateShipmentResult = {
  awb: string;
  trackingNumber: string;
  status: string;
  labelUrl?: string;
  providerMeta?: Record<string, unknown>;
};

export type TrackingEvent = {
  timestamp: string;
  status: string;
  location?: string;
  description?: string;
};

export type TrackingResult = {
  awb: string;
  status: string;
  events: TrackingEvent[];
};

export type CancelShipmentResult = {
  ok: boolean;
  awb: string;
  message?: string;
};

export type LabelResult = {
  awb: string;
  url?: string;
};

export interface CourierProvider {
  readonly name: string;
  createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult>;
  getTracking(awb: string): Promise<TrackingResult>;
  cancelShipment(awb: string): Promise<CancelShipmentResult>;
  getLabel(awb: string): Promise<LabelResult>;
}

/** Dev / demo provider — fake AWB, no external API, no dead label URLs. */
export class StubCourierProvider implements CourierProvider {
  readonly name = "stub";

  async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
    const awb = `STUB${Date.now()}`;
    console.info("[courier:stub] createShipment", {
      awb,
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      pincode: input.deliveryAddress.pincode,
    });
    return {
      awb,
      trackingNumber: awb,
      status: "created",
      providerMeta: { mode: "stub", createdAt: new Date().toISOString() },
    };
  }

  async getTracking(awb: string): Promise<TrackingResult> {
    const match = /^STUB(\d+)$/.exec(awb);
    const createdMs = match ? Number(match[1]) : Date.now() - 3 * 60 * 60 * 1000;
    const ageHours = Math.max(0, (Date.now() - createdMs) / 3_600_000);

    const events: TrackingEvent[] = [
      {
        timestamp: new Date(createdMs).toISOString(),
        status: "created",
        description: "Shipment created (stub)",
      },
    ];

    let status = "created";
    if (ageHours >= 1) {
      status = "picked_up";
      events.push({
        timestamp: new Date(createdMs + 3_600_000).toISOString(),
        status: "picked_up",
        description: "Picked up from origin (stub)",
      });
    }
    if (ageHours >= 6) {
      status = "in_transit";
      events.push({
        timestamp: new Date(createdMs + 6 * 3_600_000).toISOString(),
        status: "in_transit",
        description: "In transit (stub)",
      });
    }
    if (ageHours >= 48) {
      status = "delivered";
      events.push({
        timestamp: new Date(createdMs + 48 * 3_600_000).toISOString(),
        status: "delivered",
        description: "Delivered (stub)",
      });
    }

    return { awb, status, events };
  }

  async cancelShipment(awb: string): Promise<CancelShipmentResult> {
    return { ok: true, awb, message: "Shipment cancelled (stub provider)" };
  }

  async getLabel(awb: string): Promise<LabelResult> {
    return { awb }; // no fake PDF path
  }
}

/**
 * Ops path with zero vendor API: staff provides AWB / partner name.
 * Used when COURIER_PROVIDER=manual.
 */
export class ManualCourierProvider implements CourierProvider {
  readonly name = "manual";

  async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
    const awb =
      input.awbOverride?.trim() ||
      `MANUAL-${(input.orderNumber || input.orderId).replace(/\s+/g, "").slice(0, 24)}-${Date.now().toString(36)}`;
    console.info("[courier:manual] createShipment", {
      awb,
      orderId: input.orderId,
      partner: input.partnerName,
    });
    return {
      awb,
      trackingNumber: awb,
      status: "created",
      providerMeta: {
        mode: "manual",
        partner: input.partnerName ?? null,
        createdAt: new Date().toISOString(),
      },
    };
  }

  async getTracking(awb: string): Promise<TrackingResult> {
    return {
      awb,
      status: "manual",
      events: [
        {
          timestamp: new Date().toISOString(),
          status: "manual",
          description: "Update tracking in Logistics UI (manual courier).",
        },
      ],
    };
  }

  async cancelShipment(awb: string): Promise<CancelShipmentResult> {
    return { ok: true, awb, message: "Marked cancelled (manual provider)" };
  }

  async getLabel(): Promise<LabelResult> {
    return { awb: "" };
  }
}

type ShiprocketAuth = { token: string; expiresAt: number };

/**
 * Shiprocket (optional). Requires SHIPROCKET_EMAIL + SHIPROCKET_PASSWORD.
 * Docs: https://apidocs.shiprocket.in/
 */
export class ShiprocketCourierProvider implements CourierProvider {
  readonly name = "shiprocket";
  private auth: ShiprocketAuth | null = null;

  private requireConfig() {
    const email = process.env.SHIPROCKET_EMAIL?.trim();
    const password = process.env.SHIPROCKET_PASSWORD?.trim();
    if (!email || !password) {
      throw new Error(
        "Shiprocket is not configured. Set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD, or use COURIER_PROVIDER=manual|stub.",
      );
    }
    return { email, password };
  }

  private async getToken(): Promise<string> {
    if (this.auth && this.auth.expiresAt > Date.now() + 60_000) {
      return this.auth.token;
    }
    const { email, password } = this.requireConfig();
    const res = await fetch("https://apiv2.shiprocket.in/v1/external/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      token?: string;
      message?: string;
    };
    if (!res.ok || !data.token) {
      throw new Error(data.message || `Shiprocket auth failed (HTTP ${res.status})`);
    }
    this.auth = { token: data.token, expiresAt: Date.now() + 9 * 24 * 60 * 60 * 1000 };
    return data.token;
  }

  async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
    const token = await this.getToken();
    const addr = input.deliveryAddress;
    const res = await fetch("https://apiv2.shiprocket.in/v1/external/orders/create/adhoc", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        order_id: input.orderNumber || input.orderId,
        order_date: new Date().toISOString().slice(0, 10),
        pickup_location: process.env.SHIPROCKET_PICKUP_LOCATION?.trim() || "Primary",
        billing_customer_name: addr.name,
        billing_last_name: "",
        billing_address: addr.line1,
        billing_address_2: addr.line2 ?? "",
        billing_city: addr.city,
        billing_pincode: addr.pincode,
        billing_state: addr.state,
        billing_country: "India",
        billing_email: "orders@avyora.local",
        billing_phone: addr.phone.replace(/\D/g, "").slice(-10),
        shipping_is_billing: true,
        order_items: [
          {
            name: "Avyora jewellery",
            sku: input.orderNumber || input.orderId,
            units: 1,
            selling_price: String(input.codAmount ?? 1),
          },
        ],
        payment_method: (input.codAmount ?? 0) > 0 ? "COD" : "Prepaid",
        sub_total: input.codAmount ?? 1,
        length: 10,
        breadth: 10,
        height: 5,
        weight: Math.max(0.1, (input.weightGrams ?? 200) / 1000),
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      order_id?: number | string;
      shipment_id?: number | string;
      awb_code?: string;
      status?: string;
      message?: string;
    };

    if (!res.ok) {
      throw new Error(data.message || `Shiprocket create failed (HTTP ${res.status})`);
    }

    const awb = String(data.awb_code || data.shipment_id || data.order_id || `SR-${Date.now()}`);
    return {
      awb,
      trackingNumber: awb,
      status: String(data.status || "created"),
      providerMeta: { shiprocket: data },
    };
  }

  async getTracking(awb: string): Promise<TrackingResult> {
    const token = await this.getToken();
    const res = await fetch(
      `https://apiv2.shiprocket.in/v1/external/courier/track/awb/${encodeURIComponent(awb)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = (await res.json().catch(() => ({}))) as {
      tracking_data?: {
        track_status?: number | string;
        shipment_track?: { date?: string; status?: string; activity?: string; location?: string }[];
      };
      message?: string;
    };
    if (!res.ok) {
      throw new Error(data.message || `Shiprocket tracking failed (HTTP ${res.status})`);
    }

    const events: TrackingEvent[] = (data.tracking_data?.shipment_track ?? []).map((e) => ({
      timestamp: e.date || new Date().toISOString(),
      status: e.status || "unknown",
      location: e.location,
      description: e.activity,
    }));

    return {
      awb,
      status: String(data.tracking_data?.track_status ?? "unknown"),
      events,
    };
  }

  async cancelShipment(awb: string): Promise<CancelShipmentResult> {
    return {
      ok: false,
      awb,
      message: "Cancel via Shiprocket dashboard (API cancel not wired for all AWB types).",
    };
  }

  async getLabel(awb: string): Promise<LabelResult> {
    return { awb };
  }
}

const providers: Record<string, CourierProvider> = {
  stub: new StubCourierProvider(),
  manual: new ManualCourierProvider(),
  shiprocket: new ShiprocketCourierProvider(),
};

export function getCourierProvider(): CourierProvider {
  const name = (process.env.COURIER_PROVIDER?.trim() || "stub").toLowerCase();
  return providers[name] ?? providers.stub;
}

export function registerCourierProvider(name: string, provider: CourierProvider): void {
  providers[name.toLowerCase()] = provider;
}
