/**
 * Reports a DbOp (a repository generator, see src/database/DbOp.ts) called as a bare statement. A DbOp only runs
 * when it is delegated with `yield*` or handed to a runner, so `this.execute(sql)` on its own silently does nothing.
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Require every DbOp to be delegated with yield* or run.",
    },
    messages: {
      floating: "This DbOp never runs: delegate it with `yield*` or pass it to `this.run()`.",
    },
    schema: [],
  },

  /**
   * Create the rule listeners.
   * @param {import("eslint").Rule.RuleContext} context
   */
  create(context) {
    const services = context.sourceCode.parserServices;
    if (!services?.program || !services.esTreeNodeToTSNodeMap) {
      return {};
    }
    const checker = services.program.getTypeChecker();

    return {
      /**
       * Check a statement that consists of a single call.
       * @param {import("estree").ExpressionStatement} node
       */
      ExpressionStatement(node) {
        const expression = node.expression.type === "UnaryExpression" && node.expression.operator === "void" ? node.expression.argument : node.expression;
        if (expression.type !== "CallExpression") {
          return;
        }

        const type = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(expression));
        if (type.aliasSymbol?.getName() === "DbOp" || type.getSymbol()?.getName() === "Generator") {
          context.report({ node, messageId: "floating" });
        }
      },
    };
  },
};
