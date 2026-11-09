'use strict';

/** Erro causado por algo que a pessoa digitou ou pediu; a mensagem aparece na tela. */
class ErroUsuario extends Error {
  constructor(mensagem, status = 400) {
    super(mensagem);
    this.status = status;
  }
}

module.exports = { ErroUsuario };
