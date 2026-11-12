import { NextResponse } from "next/server";
import { ZodError } from "zod";

/** One error shape everywhere. `message` is shown to users as-is. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(e: unknown) {
  if (e instanceof ApiError) {
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  }
  if (e instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Something about that request wasn't right. Try again." } },
      { status: 400 },
    );
  }
  console.error(e);
  return NextResponse.json(
    { error: { code: "server_error", message: "Something went wrong on our side. Try again in a moment." } },
    { status: 500 },
  );
}

export function handle<A extends unknown[]>(f: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await f(...args);
    } catch (e) {
      return errorResponse(e);
    }
  };
}
