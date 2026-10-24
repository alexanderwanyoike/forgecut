import React, { type ComponentType } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as jsxDevRuntime from "react/jsx-dev-runtime";
import * as remotion from "remotion";
import * as fonts from "@remotion/fonts";
import type { graphicPackages } from "../../shared/graphic-source";
import type { TitleCardProps } from "../TitleCard";

const modules: Record<(typeof graphicPackages)[number], unknown> = {
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "react/jsx-dev-runtime": jsxDevRuntime,
  remotion,
  "@remotion/fonts": fonts,
};
export function compiledComponent(code: string): ComponentType<TitleCardProps> {
  const module: { exports: Record<string, unknown> } = { exports: {} };
  const load = (name: unknown): unknown => {
    if (
      typeof name !== "string" ||
      !Object.prototype.hasOwnProperty.call(modules, name)
    )
      throw new Error(`Package is not approved: ${String(name)}`);
    return modules[name as keyof typeof modules];
  };
  const evaluate = new Function("require", "module", "exports", code) as (
    requireModule: (name: unknown) => unknown,
    target: { exports: Record<string, unknown> },
    exports: Record<string, unknown>,
  ) => void;
  evaluate(load, module, module.exports);
  const component = module.exports.default;
  if (
    (typeof component !== "function" && typeof component !== "object") ||
    component === null
  )
    throw new Error("The component must have a default React export");
  return component as ComponentType<TitleCardProps>;
}
