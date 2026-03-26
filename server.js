const express = require('express');
const app = express();
const PORT = 3003;

app.get('/', (req, res) => {
  res.send('<h1>¡Bienvenido a la aplicación en localhost:3003!</h1>');
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
