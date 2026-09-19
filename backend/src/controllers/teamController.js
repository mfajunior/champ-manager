const { query, queryOne, queryAll } = require('../config/database');

/**
 * Uma equipe compete em exatamente uma categoria.
 * A unicidade do nome é dentro da categoria, não do campeonato: "Equipe Alpha"
 * pode existir em Iniciante Masculino e em RX Misto ao mesmo tempo.
 */

// POST /api/teams  (protegido)
// body: { championship_id, category_id, name }
exports.create = async (req, res, next) => {
  try {
    // Formato do corpo já validado pelo middleware `validate(schemas.teamCreate)`.
    const { championship_id, category_id, name } = req.body;

    const category = await queryOne(
      'SELECT id, championship_id, name FROM categories WHERE id = $1',
      [category_id]
    );

    if (!category) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Categoria não encontrada' },
      });
    }

    // Basta validar a categoria: ela já carrega o campeonato. Se o cliente mandar
    // um championship_id que não bate, é erro dele e precisa aparecer.
    if (Number(category.championship_id) !== Number(championship_id)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A categoria não pertence ao campeonato informado',
        },
      });
    }

    const duplicate = await queryOne(
      'SELECT id FROM teams WHERE category_id = $1 AND name = $2',
      [category_id, name]
    );

    if (duplicate) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: `Já existe uma equipe "${name}" na categoria ${category.name}`,
        },
      });
    }

    const team = await queryOne(
      `INSERT INTO teams (championship_id, category_id, name, registered_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, championship_id, category_id, name, registered_at`,
      [championship_id, category_id, name, req.user.id]
    );

    res.status(201).json({
      data: team,
      meta: { message: 'Equipe registrada com sucesso' },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/teams?championship_id=1&category_id=3  (público)
// category_id é opcional: sem ele, lista o campeonato inteiro.
exports.getAll = async (req, res, next) => {
  try {
    const { championship_id, category_id } = req.query;

    if (!championship_id) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'championship_id é obrigatório na query string',
        },
      });
    }

    const championship = await queryOne(
      'SELECT id FROM championships WHERE id = $1',
      [championship_id]
    );

    if (!championship) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Campeonato não encontrado' },
      });
    }

    // $2 nulo desliga o filtro de categoria sem precisar montar SQL por concatenação
    // (que abriria espaço para injeção).
    const teams = await queryAll(
      `SELECT t.id, t.championship_id, t.category_id, c.name AS category_name,
              c.gender, c.level, t.name, t.registered_at
       FROM teams t
       JOIN categories c ON c.id = t.category_id
       WHERE t.championship_id = $1
         AND ($2::int IS NULL OR t.category_id = $2::int)
       ORDER BY c.id ASC, t.name ASC`,
      [championship_id, category_id || null]
    );

    res.status(200).json({
      data: teams,
      meta: { message: 'Equipes recuperadas com sucesso', total: teams.length },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/teams/:id  (público)
exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const team = await queryOne(
      `SELECT t.id, t.championship_id, t.category_id, c.name AS category_name,
              c.gender, c.level, t.name, t.registered_at
       FROM teams t
       JOIN categories c ON c.id = t.category_id
       WHERE t.id = $1`,
      [id]
    );

    if (!team) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Equipe não encontrada' },
      });
    }

    res.status(200).json({
      data: team,
      meta: { message: 'Equipe recuperada com sucesso' },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/teams/:id/results  (público)
// Uma linha por prova do campeonato, na ordem do workout_number — inclusive
// as que essa equipe ainda não correu. Sem resultado lançado (nenhuma linha
// em `results` para o heat_team_id dela naquela prova) o campo `raw_value`
// e `place` voltam null e `did_not_finish` volta false; quem exibe decide
// como marcar "ainda não realizada" — aqui é decisão de UI, não de dado.
exports.getResults = async (req, res, next) => {
  try {
    const { id } = req.params;

    const team = await queryOne(
      'SELECT id, championship_id, category_id, name FROM teams WHERE id = $1',
      [id]
    );

    if (!team) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Equipe não encontrada' },
      });
    }

    // Uma equipe está em no máximo uma bateria por prova — mas uma prova pode
    // ter VÁRIAS baterias (uma categoria grande pode precisar de mais de uma
    // bateria pra caber, e agora baterias também misturam categorias — ver
    // migration 005). Por isso o filtro pela equipe precisa acontecer ANTES
    // de juntar com workouts, numa subquery: filtrar heats por
    // "h.workout_id = w.id" direto (sem afunilar por categoria, que a
    // bateria não tem mais) faria essa equipe casar com TODAS as baterias
    // daquela prova, gerando uma linha fantasma (h presente, resultado nulo)
    // pra cada bateria em que ela NÃO está — não só pra prova em que a
    // categoria dela nunca coube numa bateria só.
    const workouts = await queryAll(
      `SELECT
         w.id AS workout_id,
         w.workout_number,
         w.name AS workout_name,
         w.scoring_type,
         r.raw_value,
         r.did_not_finish,
         r.place
       FROM workouts w
       LEFT JOIN (
         SELECT h.workout_id, ht.id AS heat_team_id
         FROM heat_teams ht
         JOIN heats h ON h.id = ht.heat_id
         WHERE ht.team_id = $2
       ) team_heat ON team_heat.workout_id = w.id
       LEFT JOIN results r ON r.heat_team_id = team_heat.heat_team_id
       WHERE w.championship_id = $1
       ORDER BY w.workout_number ASC`,
      [team.championship_id, team.id]
    );

    res.status(200).json({
      data: { team: { id: team.id, name: team.name }, workouts },
      meta: { message: 'Resultados da equipe recuperados com sucesso', total: workouts.length },
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/teams/:id  (protegido)
// body: { name?, category_id? }
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    // "ao menos um campo presente" já é garantido pelo .min(1) do
    // schemas.teamUpdate, validado na rota.
    const { name, category_id } = req.body;

    const team = await queryOne(
      'SELECT id, championship_id, category_id, name FROM teams WHERE id = $1',
      [id]
    );

    if (!team) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Equipe não encontrada' },
      });
    }

    if (category_id !== undefined) {
      const category = await queryOne(
        'SELECT id, championship_id FROM categories WHERE id = $1',
        [category_id]
      );

      if (!category) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Categoria não encontrada' },
        });
      }

      if (Number(category.championship_id) !== Number(team.championship_id)) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'A categoria não pertence ao campeonato da equipe',
          },
        });
      }
    }

    const targetCategory = category_id ?? team.category_id;
    const targetName = name ?? team.name;

    const duplicate = await queryOne(
      'SELECT id FROM teams WHERE category_id = $1 AND name = $2 AND id <> $3',
      [targetCategory, targetName, id]
    );

    if (duplicate) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: `Já existe uma equipe "${targetName}" nessa categoria`,
        },
      });
    }

    const updated = await queryOne(
      `UPDATE teams
       SET name = $1, category_id = $2
       WHERE id = $3
       RETURNING id, championship_id, category_id, name, registered_at`,
      [targetName, targetCategory, id]
    );

    res.status(200).json({
      data: updated,
      meta: { message: 'Equipe atualizada com sucesso' },
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/teams/:id  (protegido)
// CASCADE remove heat_teams e, por tabela, os results da equipe.
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;

    const team = await queryOne('SELECT id FROM teams WHERE id = $1', [id]);

    if (!team) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Equipe não encontrada' },
      });
    }

    await query('DELETE FROM teams WHERE id = $1', [id]);

    res.status(200).json({
      data: null,
      meta: { message: 'Equipe deletada com sucesso' },
    });
  } catch (error) {
    next(error);
  }
};
