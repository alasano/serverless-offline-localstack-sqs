/* eslint-disable no-undef */
// Test handler that captures process.env at invocation time
module.exports.handler = async () => {
  return {
    capturedEnv: { ...process.env },
  };
};

module.exports.failingHandler = async () => {
  throw new Error("intentional failure");
};
