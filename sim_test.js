const d3 = require("d3-force");

const simNodes = [
  { id: "A", x: 0, y: 0 },
  { id: "B", x: 0, y: 0 },
];
const simLinks = [
  { source: "A", target: "B", weight: 0.8 }
];

d3.forceSimulation(simNodes)
  .force("link", d3.forceLink(simLinks).id(d => d.id).distance(100).strength(l => 0.25 + 0.35 * l.weight))
  .force("charge", d3.forceManyBody().strength(-200))
  .force("center", d3.forceCenter(0, 0))
  .force("collide", d3.forceCollide(50))
  .stop()
  .tick(300);

console.log(simNodes);
