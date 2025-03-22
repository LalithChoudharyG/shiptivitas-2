import express from 'express';
import Database from 'better-sqlite3';

const app = express();

app.use(express.json());

app.get('/', (req, res) => {
  return res
    .status(200)
    .send({ message: 'SHIPTIVITY API. Read documentation to see API docs' });
});

// We are keeping one connection alive for the rest of the application's life for simplicity.
const db = new Database('./clients.db');

// Close the database connection when the server is terminated.
const closeDb = () => db.close();
process.on('SIGTERM', closeDb);
process.on('SIGINT', closeDb);

/**
 * Validate id input.
 * @param {any} id
 */
const validateId = (id) => {
  if (Number.isNaN(id)) {
    return {
      valid: false,
      messageObj: {
        message: 'Invalid id provided.',
        long_message: 'Id can only be integer.',
      },
    };
  }
  const client = db
    .prepare('select * from clients where id = ? limit 1')
    .get(id);
  if (!client) {
    return {
      valid: false,
      messageObj: {
        message: 'Invalid id provided.',
        long_message: 'Cannot find client with that id.',
      },
    };
  }
  return {
    valid: true,
  };
};

/**
 * Validate priority input.
 * @param {any} priority
 */
const validatePriority = (priority) => {
  if (Number.isNaN(priority)) {
    return {
      valid: false,
      messageObj: {
        message: 'Invalid priority provided.',
        long_message: 'Priority can only be positive integer.',
      },
    };
  }
  return {
    valid: true,
  };
};

/**
 * Get all of the clients. Optional filter 'status'
 * GET /api/v1/clients?status={status} - list all clients.
 * Optional parameter status: 'backlog' | 'in-progress' | 'complete'
 */
app.get('/api/v1/clients', (req, res) => {
  const status = req.query.status;
  if (status) {
    // Status can only be either 'backlog' | 'in-progress' | 'complete'
    if (
      status !== 'backlog' &&
      status !== 'in-progress' &&
      status !== 'complete'
    ) {
      return res.status(400).send({
        message: 'Invalid status provided.',
        long_message:
          'Status can only be one of the following: [backlog | in-progress | complete].',
      });
    }
    const clients = db
      .prepare('select * from clients where status = ?')
      .all(status);
    return res.status(200).send(clients);
  }
  const statement = db.prepare('select * from clients');
  const clients = statement.all();
  return res.status(200).send(clients);
});

/**
 * Get a client based on the id provided.
 * GET /api/v1/clients/{client_id} - get client by id.
 */
app.get('/api/v1/clients/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { valid, messageObj } = validateId(id);
  if (!valid) {
    return res.status(400).send(messageObj);
  }
  return res
    .status(200)
    .send(db.prepare('select * from clients where id = ?').get(id));
});

/**
 * Update client information based on the parameters provided.
 * When status is provided, the client status will be changed.
 * When priority is provided, the client priority will be changed along with the rest of the clients accordingly.
 * Note that priority = 1 means it has the highest priority (should be on top of the swimlane).
 * No two clients in the same status should have the same priority.
 * This API returns a list of clients on success.
 *
 * PUT /api/v1/clients/{client_id} - change the status/priority of a client.
 *    Data:
 *      status (optional): 'backlog' | 'in-progress' | 'complete',
 *      priority (optional): integer.
 */
app.put('/api/v1/clients/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { valid, messageObj } = validateId(id);
  if (!valid) {
    return res.status(400).send(messageObj);
  }

  let { status, priority } = req.body;
  let clients = db.prepare('select * from clients').all();
  const client = clients.find((client) => client.id === id);

  /* ---------- Update code below ----------*/
  let newPriority;

  // If status is provided and it is different from the current one, we're moving the card to a new swimlane.
  if (status && status !== client.status) {
    // Remove the card from its current position by decrementing the priority of all cards
    // in the old swimlane that have a priority greater than the current card.
    db.prepare(
      'UPDATE clients SET priority = priority - 1 WHERE status = ? AND priority > ?'
    ).run(client.status, client.priority);

    // Determine the new priority:
    if (priority !== undefined) {
      // If a new priority is provided, shift down any card in the new swimlane that is at or below this new priority.
      newPriority = priority;
      db.prepare(
        'UPDATE clients SET priority = priority + 1 WHERE status = ? AND priority >= ?'
      ).run(status, newPriority);
    } else {
      // If no priority is provided, append the card at the end of the new swimlane.
      const row = db
        .prepare(
          'SELECT MAX(priority) as maxPriority FROM clients WHERE status = ?'
        )
        .get(status);
      newPriority = (row && row.maxPriority ? row.maxPriority : 0) + 1;
    }

    // Update the card's swimlane and new priority.
    db.prepare(
      'UPDATE clients SET status = ?, priority = ? WHERE id = ?'
    ).run(status, newPriority, id);
  } else if (priority !== undefined && priority !== client.priority) {
    // Reordering within the same swimlane.
    if (priority > client.priority) {
      // Moving the card down: decrement the priority for cards between the current and new positions.
      db.prepare(
        'UPDATE clients SET priority = priority - 1 WHERE status = ? AND priority > ? AND priority <= ?'
      ).run(client.status, client.priority, priority);
    } else if (priority < client.priority) {
      // Moving the card up: increment priorities for cards between the new and current positions.
      db.prepare(
        'UPDATE clients SET priority = priority + 1 WHERE status = ? AND priority >= ? AND priority < ?'
      ).run(client.status, priority, client.priority);
    }
    // Update the moved card's priority.
    db.prepare('UPDATE clients SET priority = ? WHERE id = ?').run(priority, id);
  }

  // After the update(s), fetch the latest list of clients.
  clients = db.prepare('SELECT * FROM clients').all();
  /* ---------- End update code ----------*/

  return res.status(200).send(clients);
});

app.listen(3001);
console.log('app running on port ', 3001);
