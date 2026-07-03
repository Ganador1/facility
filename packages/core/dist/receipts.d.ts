import { z } from 'zod';

declare const FacilityReceiptSchema: z.ZodObject<{
    schema: z.ZodLiteral<"facility.run.v1">;
    provider: z.ZodEnum<{
        claude_code: "claude_code";
        codex_cli: "codex_cli";
        byo: "byo";
    }>;
    mode: z.ZodEnum<{
        custom: "custom";
        architect: "architect";
        builder: "builder";
        review: "review";
        address_review: "address_review";
        ci_doctor: "ci_doctor";
        security_sweep: "security_sweep";
        po: "po";
        learning: "learning";
    }>;
    result: z.ZodString;
    usage: z.ZodObject<{
        input_tokens: z.ZodNumber;
        output_tokens: z.ZodNumber;
        cache_read: z.ZodOptional<z.ZodNumber>;
        cache_write: z.ZodOptional<z.ZodNumber>;
        cost_cents: z.ZodNullable<z.ZodNumber>;
        cost_source: z.ZodString;
    }, z.core.$strip>;
    activity: z.ZodObject<{
        turns: z.ZodNumber;
        shell_commands: z.ZodNumber;
        file_changes: z.ZodNumber;
        mcp_tool_calls: z.ZodNumber;
        web_searches: z.ZodNumber;
        tool_calls: z.ZodNumber;
        errors: z.ZodNumber;
    }, z.core.$strip>;
    github: z.ZodOptional<z.ZodObject<{
        owner: z.ZodOptional<z.ZodString>;
        repo: z.ZodOptional<z.ZodString>;
        issue: z.ZodOptional<z.ZodNumber>;
        pr: z.ZodOptional<z.ZodNumber>;
        actor_sha256: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    timing: z.ZodObject<{
        started_at: z.ZodString;
        ended_at: z.ZodOptional<z.ZodString>;
        duration_ms: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>;
}, z.core.$strip>;
type FacilityReceipt = z.infer<typeof FacilityReceiptSchema>;
declare function parseTamOsReceipt(json: unknown): FacilityReceipt;

export { type FacilityReceipt, FacilityReceiptSchema, parseTamOsReceipt };
