const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

async function _createUser(context, signUpObject) {
  return context.db.mutation.createUser(
    {
      data: {
        ...signUpObject
      }
    },
    `{id}`
  );
}

async function createUser(root, args, context, info, callback = _createUser) {
  const signUpObject = args.data;
  if (!signUpObject.securityQuestions)
    signUpObject.securityQuestions = 'Password';
  try {
    signUpObject.securityAnswers = await bcrypt.hash(
      signUpObject.securityAnswers,
      10
    );
  } catch (error) {
    throw new Error('Invalid security answers');
  }
  const user = await callback(context, signUpObject);
  const token = jwt.sign({ userId: user.id }, process.env.APP_SECRET);
  return {
    token,
    user
  };
}

async function _getAuthObject(context, contactNumber) {
  return context.db.query.user(
    { where: { contactNumber: contactNumber } },
    `{id securityAnswers}`
  );
}

async function login(root, args, context, info, callback = _getAuthObject) {
  const user = await callback(context, args.contactNumber);
  if (!user) throw new Error('User not found');
  const valid = await bcrypt.compare(
    args.securityAnswers,
    user.securityAnswers
  );
  if (!valid) throw new Error('Incorrect password');
  const token = jwt.sign({ userId: user.id }, process.env.APP_SECRET);
  return {
    token,
    user
  };
}

async function createGroup(parent, args, context, info) {
  let users = [];
  let admin = { contactNumber: args.data.admin_contactNumber };
  const { colorScheme, welcomeText, description } = args.data;
  if (args.data.users_contactNumbers) {
    users = args.data.users_contactNumbers.map(contactNumber => {
      return { contactNumber: contactNumber };
    });
  }
  const group = await context.db.mutation.createGroup(
    {
      data: {
        users: { connect: [...users, admin] },
        admin: {
          connect: admin
        },
        welcomeText,
        colorScheme,
        description
      }
    },
    info
  );
  return group;
}

async function createPost(parent, args, context, info) {
  const options = {};
  options.group = { connect: { id: args.groupId } };
  options.user = { connect: { contactNumber: args.contactNumber } };
  if (args.tags_contactNumbers) {
    const arrayUsers = args.tags_contactNumbers.map(contactNumber => {
      return { user: { connect: { contactNumber: contactNumber } } };
    });
    options.tags = { create: arrayUsers };
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

// async function createComment(parent, args, context, info) {}

module.exports = {
  createUser,
  login,
  createGroup,
  createPost,
  createTag
  //createComment
};
