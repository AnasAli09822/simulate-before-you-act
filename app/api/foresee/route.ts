import { NextResponse } from "next/server";
import { z } from "zod";
import { executeSimulation, getState, initDemo, rejectSimulation, resetDemo, rollbackExecution, simulate } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  op: z.enum(["init", "reset", "state", "simulate", "execute", "rollback", "reject"]),
  session_id: z.string().uuid(),
  plan: z.unknown().optional(),
  simulation_id: z.string().uuid().optional(),
  execution_id: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    let result: unknown;
    switch (input.op) {
      case "init": result = await initDemo(input.session_id); break;
      case "reset": result = await resetDemo(input.session_id); break;
      case "state": result = await getState(input.session_id); break;
      case "simulate":
        if (!input.plan) throw new Error("plan is required");
        result = await simulate(input.session_id, input.plan);
        break;
      case "execute":
        if (!input.simulation_id) throw new Error("simulation_id is required");
        result = await executeSimulation(input.session_id, input.simulation_id);
        break;
      case "rollback":
        if (!input.execution_id) throw new Error("execution_id is required");
        result = await rollbackExecution(input.session_id, input.execution_id);
        break;
      case "reject":
        if (!input.simulation_id) throw new Error("simulation_id is required");
        result = await rejectSimulation(input.session_id, input.simulation_id);
        break;
    }
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
