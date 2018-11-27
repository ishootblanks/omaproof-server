const jwt = require('jsonwebtoken');
const uuidv4 = require('uuid/v4');

async function createUser(root, args, context) {
  // auto generate password:
  args.data.password = uuidv4();
  const user = await context.db.mutation.createUser(
    {
      data: {
        ...args.data
      }
    },
    `{id}`
  );
  const token = jwt.sign(
    { userId: user.id, activeGroup: null },
    process.env.APP_SECRET
  );
  return {
    token,
    user
  };
}

async function login(root, args, context) {
  const user = await context.db.query.user(
    { where: { contactNumber: args.contactNumber } },
    `{id password groups}`
  );
  if (!user) throw new Error('User not found');
  const valid = args.password === user.password;
  if (!valid) throw new Error('Incorrect password');
  const token = jwt.sign(
    { userId: user.id, activeGroup: null },
    process.env.APP_SECRET
  );
  return {
    token,
    user
  };
}

async function selectGroup(parent, args, context) {
  const user = await context.db.query.user(
    { where: { Id: context.userId } },
    `{id password groups}`
  );
  if (user.groups.indexOf(args.groupId) <= -1) {
    throw new Error('GroupId not available for user');
  } else {
    const token = jwt.sign(
      {
        userId: context.userId,
        activeGroup: args.groupId
      },
      process.env.APP_SECRET
    );
    return {
      token,
      user
    };
  }
}

async function createGroup(parent, args, context) {
  const newUserContactNumbers = [];
  const oldUserContactNumbers = [];
  const admin = { id: context.userId };
  for (let index = 0; index < args.contactNumbers.length; index++) {
    const number = args.contactNumbers[index];
    const user = await context.db.query.user(
      {
        where: {
          contactNumber: number
        }
      },
      `{id}`
    );
    user
      ? oldUserContactNumbers.push({ contactNumber: number })
      : newUserContactNumbers.push({ contactNumber: number });
  }

  const group = await context.db.mutation.createGroup(
    {
      data: {
        ...args.data,
        admin: {
          connect: admin
        },
        users: {
          connect: [admin, ...oldUserContactNumbers],
          create: [...newUserContactNumbers]
        }
      }
    },
    `{id}`
  );
  const signature = {
    userId: context.userId,
    activeGroup: group.id
  };
  const token = jwt.sign(signature, process.env.APP_SECRET);
  return {
    token,
    group
  };
}

async function createPost(parent, args, context, info) {
  const options = {};
  options.group = { connect: { id: args.groupId } };
  options.user = { connect: { contactNumber: args.contactNumber } };
  if (args.tags_contactNumbers) {
    options.tags = _createTags(args.tags_contactNumbers);
  }
  return await context.db.mutation.createPost(
    {
      data: {
        ...args.content,
        ...options
      }
    },
    info
  );
}

async function createTag(parent, args, context, info) {
  const link = {};
  args.isPost
    ? (link.link_post = { connect: { id: args.contentId } })
    : (link.link_comment = { connect: { id: args.contentId } });
  return await context.db.mutation.createTag(
    {
      data: {
        user: { connect: { contactNumber: args.contactNumber } },
        ...link
      }
    },
    info
  );
}

async function createComment(parent, args, context, info) {
  const options = {};
  options.post = { connect: { id: args.postId } };
  options.user = { connect: { contactNumber: args.contactNumber } };
  if (args.tags_contactNumbers) {
    options.tags = _createTags(args.tags_contactNumbers);
  }
  return await context.db.mutation.createComment(
    {
      data: {
        ...args.content,
        ...options
      }
    },
    info
  );
}

function _createTags(tags_contactNumbers) {
  const arr = tags_contactNumbers.map(contactNumber => {
    return { user: { connect: { contactNumber: contactNumber } } };
  });
  return { create: arr };
}

module.exports = {
  createUser,
  login,
  createGroup,
  selectGroup,
  createPost,
  createTag,
  createComment
};
