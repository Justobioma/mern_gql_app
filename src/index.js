const { ApolloServer, gql } = require("apollo-server");
const { MongoClient, ObjectID } = require("mongodb");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
dotenv.config();

const { DB_URI, DB_NAME, JWT_SECRET } = process.env;

//Define a separate function that will encrypt 'this' user
const getToken = (user) =>
  jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "15 days" });

const getUserFromToken = async (token, db) => {
  if (!token) {
    return null;
  }

  const tokenData = jwt.verify(token, JWT_SECRET);
  console.log(tokenData);
  if (!tokenData?.id) {
    return null;
  }

  return (user = await db
    .collection("Users")
    .findOne({ _id: ObjectID(tokenData.id) }));
};

const typeDefs = gql`
  type Query {
    myTaskLists: [TaskList!]!
    getTaskList(id: ID!): TaskList
  }

  type Mutation {
    signUp(input: SignUpInput): AuthUser!
    signIn(input: SignInInput): AuthUser!

    createTaskList(title: String!): TaskList!
    updateTaskList(id: ID!, title: String!): TaskList!
    deleteTaskList(id: ID!): Boolean
  }

  input SignUpInput {
    email: String!
    password: String!
    name: String!
    avatar: String
  }

  input SignInInput {
    email: String!
    password: String!
  }

  type AuthUser {
    user: User!
    token: String!
  }

  type User {
    id: ID!
    name: String!
    email: String!
    avatar: String
  }

  type TaskList {
    id: ID!
    createdAt: String!
    title: String!
    progress: Float!

    users: [User!]!
    todos: [ToDo!]!
  }

  input TaskListInput {
    title: String!
  }

  type ToDo {
    id: ID!
    content: String!
    isCompleted: Boolean!

    taskList: TaskList
  }
`;

const resolvers = {
  //functions that define we should get the data for the specific fields.
  //They have same structure as the Typedef above
  Query: {
    myTaskLists: async (_, __, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error. Please sign in");
      }

      return await db
        .collection("TaskList")
        .find({ userIds: user._id })
        .toArray();
    },

    getTaskList: async (_, { id }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error. Please sign in");
      }
      //TODO only collaborators of this task list should be able to delete
      return await db.collection("TaskList").findOne({ _id: ObjectID(id) });
    },
  },
  Mutation: {
    signUp: async (_, { input }, { db }) => {
      const hashedPassword = bcrypt.hashSync(input.password);
      const newUser = {
        ...input,
        password: hashedPassword,
      };
      // save to database

      const result = await db.collection("Users").insertOne(newUser);
      const user = result.ops[0];
      return {
        user,
        token: getToken(user),
      };
    },

    signIn: async (_, { input }, { db }) => {
      const user = await db.collection("Users").findOne({ email: input.email });
      //console.log(user);
      if (!user) {
        throw new Error("Invalid credentials!");
      }

      //check if password is correct
      const isPasswordCorrect = bcrypt.compareSync(
        input.password,
        user.password
      );
      if (!isPasswordCorrect) {
        throw new Error("Invalid credentials!");
      }

      return {
        user,
        token: getToken(user),
      };
    },

    createTaskList: async (_, { title }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error. Please sign in");
      }

      const newTaskList = {
        title,
        createdAt: new Date().toISOString(),
        userIds: [user._id],
      };
      const result = await db.collection("TaskList").insert(newTaskList);
      return result.ops[0];
    },

    updateTaskList: async (_, { id, title }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error. Please sign in");
      }

      const result = await db.collection("TaskList").updateOne(
        {
          _id: ObjectID(id),
        },
        {
          $set: {
            title,
          },
        }
      );
      return await db.collection("TaskList").findOne({ _id: ObjectID(id) });
      // console.log(result);
      // return result.ops[0];
    },

    deleteTaskList: async (_, { id }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error. Please sign in");
      }
      //TODO only collaborators of this task list should be able to delete
      await db.collection("TaskList").removeOne({ _id: ObjectID(id) });

      return true;
    },
  },

  //defining the 'User' type
  User: {
    id: ({ _id, id }) => _id || id,
  },

  TaskList: {
    id: ({ _id, id }) => _id || id,
    progress: () => 0,
    users: async ({ userIds }, _, { db }) =>
      Promise.all(
        userIds.map((userId) => db.collection("Users").findOne({ _id: userId }))
      ),
  },
};

const start = async () => {
  const client = new MongoClient(DB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  await client.connect();
  // perform actions on the collection object
  //client.close();
  const db = client.db(DB_NAME);

  const context = {
    db,
  };

  // The ApolloServer constructor requires two parameters: your schema
  // definition and your set of resolvers.
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    context: async ({ req }) => {
      const user = await getUserFromToken(req.headers.authorization, db);

      return {
        db,
        user,
      };
    },
  });

  // The `listen` method launches a web server.
  server.listen().then(({ url }) => {
    console.log(`🚀  Server ready at ${url}`);
  });
};

start();
