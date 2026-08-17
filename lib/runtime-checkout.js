const RUNTIME_SPARSE_PATTERNS = Object.freeze([
  "/*",
  "!/contributors/"
]);

function configureRuntimeSparseCheckout(sourceDirectory, runGit) {
  runGit(
    ["-C", sourceDirectory, "sparse-checkout", "set", "--no-cone", "--stdin"],
    { input: `${RUNTIME_SPARSE_PATTERNS.join("\n")}\n` }
  );
}

module.exports = {
  RUNTIME_SPARSE_PATTERNS,
  configureRuntimeSparseCheckout
};
