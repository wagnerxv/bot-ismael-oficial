const MOTORISTA_CONFIG = {
    nome: 'Ismael',
    telefone: '(82) 99651-8468', // O número que vai receber a notificação
    pix: '609.950.773-63',
    veiculo: { modelo: 'Sandero Branco', placa: 'QBI9I82' },
    cidade: 'Planalto da Serra - MT'
};

const LOCAIS_CONFIG = {
    urbanos: {
        'Centro': { preco: 15, tempo: 10 },
        'Rodoviária': { preco: 18, tempo: 12 },
        'Hospital': { preco: 20, tempo: 15 },
        'Shopping': { preco: 22, tempo: 18 },
        'Prefeitura': { preco: 16, tempo: 11 },
        'Escola Municipal': { preco: 17, tempo: 13 },
        'Posto de Saúde': { preco: 19, tempo: 14 },
        'Banco do Brasil': { preco: 16, tempo: 12 }
    },
    rurais: {
        'Zona Rural Norte': { preco: 35, tempo: 25 },
        'Zona Rural Sul': { preco: 38, tempo: 28 },
        'Sítio São João': { preco: 40, tempo: 30 },
        'Fazenda Esperança': { preco: 45, tempo: 35 },
        'Chácara Boa Vista': { preco: 42, tempo: 32 },
        'Assentamento Primavera': { preco: 48, tempo: 38 }
    },
    vizinhas: {
        'Cuiabá Centro': { preco: 80, tempo: 60 },
        'Várzea Grande': { preco: 75, tempo: 55 },
        'Aeroporto Cuiabá': { preco: 85, tempo: 65 },
        'Shopping Cuiabá': { preco: 82, tempo: 62 },
        'Terminal Rodoviário CBA': { preco: 78, tempo: 58 },
        'UFMT': { preco: 88, tempo: 68 }
    }
};

const MULTIPLICADOR_PASSAGEIROS = { 1: 1.0, 2: 1.0, 3: 1.2, 4: 1.4 };

module.exports = { MOTORISTA_CONFIG, LOCAIS_CONFIG, MULTIPLICADOR_PASSAGEIROS };
